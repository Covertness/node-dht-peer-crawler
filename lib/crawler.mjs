import KBucket from 'k-bucket'
import hat from 'hat'
import Network from './network'
import fs from 'fs'
import { QueryMessage, ResponseMessage } from './message'
import Node from './node'
import InfoHash from './infoHash'

export default class Crawler {
  constructor(listenPort) {
    this.config = {
      minFindInterval: 1000,
      maxFindInterval: 2 * 60 * 1000,
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

    this.bootstrapNode = new Node(
      new Buffer(''),
      {
        ip: 'router.bittorrent.com',
        // ip: 'dht.transmissionbt.com',
        port: 6881
      }
    )
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
      let queriedInfoHashCount = 0
      this.infoHashTable.forEach(info => {
        foundInfoHashCount += info.announceNodes.size
        queriedInfoHashCount += info.queryNodes.size
      })
      console.log(`found info_hash length: ${foundInfoHashCount}`)
      console.log(`queried info_hash length: ${queriedInfoHashCount}`)

      if (allNodesCount > this.config.persistentPeersLen) {
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
    const allNodes = this.routeTable.toArray()
    allNodes.forEach(node => {
      node.destroy()
    })
    this.infoHashTable.forEach(info => {
      info.destroy()
    })
    this.infoHashTable.clear()
    this.messageTable.forEach(msg => {
      msg.destroy()
    })
    this.messageTable.clear()

    await this.network.destroy()
  }

  ping(remoteNode) {
    const message = this.createQueryMessage('ping', {
      id: this.nodeId
    }, (resp, _remoteAddress) => {
      if (resp.id == undefined) return

      if (KBucket.distance(remoteNode.id, resp.id) == 0) {
        remoteNode.refresh()
      } else if (remoteNode == this.bootstrapNode) {
        remoteNode.id = resp.id
        remoteNode.refresh()
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
      torrent.refresh()
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
      torrent.refresh()

      if (node) {
        node.announceNodes.add(infoHashStr)
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
    msg.responseHandler && msg.responseHandler(message.response, address)
    msg.destroy()
  }

  handleErrorMessage(message, address) {
    // console.error(`receive error message ${message.error} from ${address.ip}`)
  }

  createQueryMessage(action, params, responseHandler) {
    const id = this.constructor.generateId(2)
    const message = new QueryMessage(id, action, params, responseHandler)
    message.on('destroy', () => {
      this.messageTable.delete(id)
    })

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
            createdAt: peer.createdAt
          }
          this.addNode(peerNode)
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
      existNode.refresh()
      return existNode
    }

    if (KBucket.distance(node.id, this.nodeId) != 0) {
      const newNode = new Node(node.id, node.address, true, node.createdAt)
      newNode.on('ping', () => {
        this.ping(newNode)
      })
      newNode.on('destroy', () => {
        this.routeTable.remove(node.id)
      })

      this.routeTable.add(newNode)
      return newNode
    }
  }

  persistentNodes() {
    const allNodes = this.routeTable.toArray()
    const exceptBootstrap = allNodes.filter(n => n.address.ip !== this.bootstrapNode.address.ip)
    const sortedNodes = exceptBootstrap.sort((a, b) => {
      return b.calNodeScore() - a.calNodeScore()
    })
    const persistentedNodes = sortedNodes.slice(0, this.config.persistentPeersLen).map(n => {
      return {
        id: n.id.toString('base64'),
        address: n.address,
        createdAt: n.createdAt,
        announceNodesCount: n.announceNodes.size
      }
    })
    fs.writeFile(this.config.peersFile, JSON.stringify(persistentedNodes), error => {
      if (error) console.error('persistent nodes failed', error)
    })
  }

  addInfoHash(infoHash) {
    if (this.infoHashTable.size > this.config.maxInfoHashTableLen) return

    const torrent = new InfoHash()
    torrent.on('destroy', () => {
      this.infoHashTable.delete(infoHash)
    })

    this.infoHashTable.set(infoHash, torrent)
    return torrent
  }

  static generateId(len) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    const text = Array.from(Array(len).keys()).map(i => chars.charAt(Math.floor((Math.random() * chars.length))))
    return text.join('')
  }
}