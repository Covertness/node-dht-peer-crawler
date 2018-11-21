import KBucket from 'k-bucket'
import hat from 'hat'
import Network from './network'
import fs from 'fs'
import hll from 'hll'
import { QueryMessage, ResponseMessage } from './message'

export default class Crawler {
  constructor(listenPort) {
    this.config = {
      messageTimeout: 60 * 1000,
      pingInterval: 3 * 60 * 1000,
      minFindInterval: 1000,
      maxFindInterval: 2 * 60 * 1000,
      infoHashTimeout: 30 * 60 * 1000,
      maxRouteTableLen: 1000,
      maxInfoHashTableLen: 15000,
      persistentPeersLen: 100,
      nodeIdFile: '.nodeid.data',
      peersFile: '.peers.data'
    }

    this.messageTable = new Map()
    this.infoHashTable = new Map()

    this.token = this.constructor.generateId(8)
    this.peerId = '-TS0008-' + hat(48)

    this.network = new Network(listenPort)
    this.network.on('message', (message, address) => {
      switch (message.type) {
        case 'query': return this.handleQueryMessage(message, address)
        case 'response': return this.handleResponseMessage(message, address)
        case 'error': return this.handleErrorMessage(message, address)
        default: return
      }
    })
  }

  async start() {
    const initRoute = () => {
      return new Promise((resolve, reject) => {
        fs.readFile(this.config.nodeIdFile, 'utf-8', (_, data) => {
          let localNodeId
          if (data) {
            const idBuffer = new Buffer(data, 'base64')
            if (idBuffer.length == 20) localNodeId = idBuffer
          }

          this.routeTable = new KBucket({
            localNodeId: localNodeId
          })
          this.nodeId = this.routeTable.localNodeId

          fs.writeFile(this.config.nodeIdFile, this.nodeId.toString('base64'), error => {
            if (error) return reject(error)

            resolve()
          })
        })
      })
    }

    await initRoute()
    await this.network.build()

    this.bootstrapNode = {
      id: new Buffer(''),
      address: {
        ip: 'router.bittorrent.com',
        // ip: 'dht.transmissionbt.com',
        port: 6881
      },
      lastActive: Date.now(),
      pingInterval: setInterval(() => {
        this.ping(this.bootstrapNode)
      }, this.config.pingInterval)
    }

    this.routeTable.add(this.bootstrapNode)
    await this.loadLastRoutes()

    const findDivNum = Math.pow((this.config.maxRouteTableLen), 2) / (this.config.maxFindInterval - this.config.minFindInterval)
    const findOnce = () => {
      const allNodesCount = this.routeTable.count()

      const currentTimeout = this.config.maxFindInterval - Math.pow((allNodesCount - this.config.maxRouteTableLen), 2) / findDivNum
      this.findInterval = setTimeout(findOnce, currentTimeout)

      console.log(`route table length: ${allNodesCount}`)
      console.log(`info_hash table length: ${this.infoHashTable.size}`)
      let foundInfoHashCount = 0
      this.infoHashTable.forEach(info => {
        if (info.announceNodes.size > 0) foundInfoHashCount += 1
      })
      console.log(`found info_hash length: ${foundInfoHashCount}`)

      if (allNodesCount >= this.config.persistentPeersLen) {
        this.persistentNodes()
      }

      if (allNodesCount < this.config.maxRouteTableLen) {
        this.findMoreNodes()
      } else {
        this.getMorePeers()
      }

    }

    this.findInterval = setTimeout(findOnce, this.config.minFindInterval)
  }

  async stop() {
    this.findInterval && clearTimeout(this.findInterval)
    this.findInterval = undefined
    const allNodes = this.routeTable.toArray()
    allNodes.forEach(node => {
      clearInterval(node.pingInterval)
      this.routeTable.remove(node.id)
    })

    await this.network.destroy()
  }

  ping(remoteNode) {
    const message = this.createQueryMessage('ping', {
      id: this.nodeId
    }, (resp, _remoteAddress) => {
      if (resp.id == undefined) return

      if (KBucket.distance(remoteNode.id, resp.id) == 0) {
        remoteNode.lastActive = Date.now()
      } else if (remoteNode == this.bootstrapNode) {
        remoteNode.id = resp.id
        remoteNode.lastActive = Date.now()
      }
    })

    this.network.sendMessage(message, remoteNode.address)
  }

  handlePing(message, address) {
    const resp = new ResponseMessage(message.id, {
      id: this.nodeId
    })
    this.network.sendMessage(resp, address)
  }

  findMoreNodes() {
    const allNodes = this.routeTable.toArray()
    allNodes.forEach(node => {
      this.findNode(node)
    })
  }

  findNode(remoteNode) {
    const message = this.createQueryMessage('find_node', {
      id: this.nodeId,
      target: this.nodeId
    }, (resp, _remoteAddress) => {
      if (resp.id == undefined || resp.nodes == undefined) return

      this.addNodes(resp.nodes)
    })

    this.network.sendMessage(message, remoteNode.address)
  }

  handleFindNode(message, address) {
    const params = message.params
    if (params.id == undefined || params.target == undefined) return

    this.addNode({ id: params.id, address: address })

    const nodes = this.routeTable.closest(params.target, 16)
    const nodesBin = QueryMessage.serializeNodes(nodes)

    const resp = new ResponseMessage(message.id, {
      id: this.nodeId,
      nodes: nodesBin
    })
    this.network.sendMessage(resp, address)
  }

  getMorePeers() { }

  handleGetPeers(message, address) {
    const params = message.params
    if (params.id == undefined || params.info_hash == undefined) return

    this.addNode({ id: params.id, address: address })

    const infoHashStr = params.info_hash.toString('hex')
    let torrent
    if (this.infoHashTable.has(infoHashStr)) {
      torrent = this.infoHashTable.get(infoHashStr)
    } else {
      torrent = this.addInfoHash(infoHashStr)
    }

    if (torrent !== undefined) {
      torrent.queryNodes.add(params.id.toString('hex'))
      torrent.lastActive = Date.now()
    }

    let resp
    if (torrent && torrent.announceNodes.size > 0) {
      const peers = Array.from(torrent.announceNodes)
      resp = new ResponseMessage(message.id, {
        id: this.nodeId,
        token: this.token,
        values: QueryMessage.serializePeers(peers)
      })
    } else {
      const nodes = this.routeTable.closest(params.info_hash, 16)
      const nodesBin = QueryMessage.serializeNodes(nodes)

      resp = new ResponseMessage(message.id, {
        id: this.nodeId,
        token: this.token,
        nodes: nodesBin
      })
    }

    this.network.sendMessage(resp, address)
  }

  handleAnnouncePeer(message, address) {
    const params = message.params
    if (params.id == undefined || params.info_hash == undefined || params.port == undefined) return

    const node = this.addNode({ id: params.id, address: address })

    const infoHashStr = params.info_hash.toString('hex')
    let torrent
    if (this.infoHashTable.has(infoHashStr)) {
      torrent = this.infoHashTable.get(infoHashStr)
    } else {
      torrent = this.addInfoHash(infoHashStr)
    }

    if (torrent !== undefined) {
      const ipStr = address.ip
      let port
      if (params.implied_port != undefined && params.implied_port == 1) {
        port = address.port
      } else {
        port = params.port
      }

      const addressStr = ipStr + ':' + port
      torrent.announceNodes.add(addressStr)
      torrent.lastActive = Date.now()

      if (node) {
        node.announceNodes.insert(infoHashStr)
      }
    }

    const resp = new ResponseMessage(message.id, {
      id: this.nodeId
    })
    this.network.sendMessage(resp, address)
  }

  handleQueryMessage(message, address) {
    if (message.id == undefined || message.action == undefined || message.params == undefined) {
      return
    }

    const action = message.action
    if (action == 'ping') {
      this.handlePing(message, address)
    } else if (action == 'find_node') {
      this.handleFindNode(message, address)
    } else if (action == 'get_peers') {
      this.handleGetPeers(message, address)
    } else if (action == 'announce_peer') {
      this.handleAnnouncePeer(message, address)
    } else {
      console.error(`receive unknown query message ${action} from ${address.ip}`)
    }
  }

  handleResponseMessage(message, address) {
    if (message.id == undefined || message.response == undefined) return

    const transactionId = message.id
    if (!this.messageTable.has(transactionId))
      return

    const msg = this.messageTable.get(transactionId)
    clearTimeout(msg.timeout)

    msg.responseHandler && msg.responseHandler(message.response, address)
    this.messageTable.delete(transactionId)
  }

  handleErrorMessage(message, address) {
    console.error(`receive unknown query message ${message.error} from ${address.ip}`)
  }

  createQueryMessage(action, params, responseHandler) {
    const id = this.constructor.generateId(2)
    const message = new QueryMessage(id, action, params, responseHandler, setTimeout(() => {
      this.messageTable.delete(id)
    }, this.config.messageTimeout))
    
    this.messageTable.set(id, message)
    return message
  }

  loadLastRoutes() {
    return new Promise((resolve) => {
      fs.readFile(this.config.peersFile, 'utf-8', (_, data) => {
        if (!data) return resolve()

        let peers = []
        try {
          peers = JSON.parse(data)
        } catch (e) { }

        peers.forEach(peer => {
          const peerNode = {
            id: new Buffer(peer.id, 'base64'),
            address: peer.address,
            lastActive: Date.now(),
            createdAt: peer.createdAt,
            announceNodes: hll(),
            pingInterval: setInterval(() => {
              this.ping(this.peerNode)
            }, this.config.pingInterval)
          }

          this.routeTable.add(peerNode)
        })

        resolve()
      })
    })
  }

  addNodes(nodesBin) {
    const nodes = ResponseMessage.parseNodes(nodesBin)
    nodes.forEach(n => this.addNode(n))
  }

  addNode(node) {
    if (this.routeTable.count() > this.config.maxRouteTableLen) return

    const existNode = this.routeTable.get(node.id)

    if (existNode) {
      existNode.lastActive = Date.now()
      return existNode
    }

    if (KBucket.distance(node.id, this.nodeId) != 0) {
      node.lastActive = Date.now()
      node.createdAt = Date.now()
      node.announceNodes = hll()
      node.pingInterval = setInterval(() => {
        this.ping(node)
      }, this.config.pingInterval)
      node.checkInterval = setInterval(() => {
        if (Date.now() - node.lastActive > 3 * this.config.pingInterval) {
          clearInterval(node.pingInterval)
          clearInterval(node.checkInterval)
          this.routeTable.remove(node.id)
        }
      }, 3 * this.config.pingInterval)

      this.routeTable.add(node)
      return node
    }
  }

  persistentNodes() {
    const allNodes = this.routeTable.toArray()
    const sortedNodes = allNodes.sort((a, b) => {
      const scoreA = this.constructor.calNodeScore(a)
      const scoreB = this.constructor.calNodeScore(b)
      return scoreB - scoreA
    })
    const persistentedNodes = sortedNodes.slice(0, this.config.persistentPeersLen).map(n => {
      return {
        id: n.id.toString('base64'),
        address: n.address,
        createdAt: n.createdAt,
        announceNodesCount: n.announceNodes.estimate()
      }
    })
    fs.writeFile(this.config.peersFile, JSON.stringify(persistentedNodes))
  }

  addInfoHash(infoHash) {
    if (this.infoHashTable.length > this.config.maxInfoHashTableLen) return

    const torrent = {
      queryNodes: new Set(),
      announceNodes: new Set(),
      lastActive: Date.now(),
      checkInterval: setInterval(() => {
        if (Date.now() - torrent.lastActive >= this.config.infoHashTimeout) {
          clearInterval(torrent.checkInterval)
          this.infoHashTable.delete(infoHash)
        }
      }, this.config.infoHashTimeout)
    }

    this.infoHashTable.set(infoHash, torrent)
    return torrent
  }

  static calNodeScore(node) {
    return parseInt((Date.now() - node.createdAt) / (1000 * 60)) + node.announceNodes.estimate() * 60
  }

  static generateId(len) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    const text = Array.from(Array(len).keys()).map(i => chars.charAt(Math.floor((Math.random() * chars.length))))
    return text.join('')
  }
}