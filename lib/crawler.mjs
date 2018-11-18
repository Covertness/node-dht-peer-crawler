import KBucket from 'k-bucket'
import hat from 'hat'
import Network from './network'
import fs from 'fs'
import { QueryMessage, ResponseMessage } from './message'

export default class Crawler {
  constructor(listenPort) {
    this.config = {
      messageTimeout: 60 * 1000,
      pingInterval: 3 * 60 * 1000,
      findInterval: 2 * 60 * 1000,
      infoHashTimeout: 30 * 60 * 1000,
      maxRouteTableLen: 1000,
      maxInfoHashTableLen: 15000,
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

    const loadLastRoutes = () => {
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

    await initRoute()
    await this.network.build()

    this.bootstrapNode = {
      id: new Buffer(''),
      address: {
        ip: 'router.bittorrent.com',
        port: 6881
      },
      lastActive: Date.now(),
      pingInterval: setInterval(() => {
        this.ping(this.bootstrapNode)
      }, this.config.pingInterval)
    }

    this.routeTable.add(this.bootstrapNode)
    await loadLastRoutes()

    this.findMoreNodes()

    this.findInterval = setInterval(() => {
      const allNodes = this.routeTable.toArray()

      console.log(`route table length: ${allNodes.length}`)
      console.log(`info_hash table length: ${this.infoHashTable.size}`)

      if (allNodes.length < this.config.maxRouteTableLen) {
        this.findMoreNodes()
      } else {
        this.getMorePeers()
      }

    }, this.config.findInterval)
  }

  async stop() {
    clearInterval(this.findInterval)
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
      if (resp.id == undefined || esp.nodes == undefined) return

      this.addNodes(resp.nodes)
    })

    this.network.sendMessage(message, remoteNode.address)
  }

  getMorePeers() { }

  handleQueryMessage(message, address) {
    if (message.id == undefined || message.action == undefined || message.params == undefined) {
      return
    }

    const action = message.action
    if (action == 'ping') {
      this.handlePing(message, address)
    } else {
      console.error(`receive unknown query message ${action} from ${address.ip}`)
    }
  }

  handleResponseMessage(message, address) {
    if (message.id == undefined || message.response == undefined) return

    transactionId = message.id
    if (!this.messageTable.has(transactionId))
      return

    message = this.messageTable.get(transactionId)
    clearTimeout(message.timeout)

    message.responseHandler && message.responseHandler(message.response, address)
    this.messageTable.delete(transactionId)
  }

  handleErrorMessage(message, address) { }

  createQueryMessage(action, params, responseHandler) {
    const id = this.constructor.generateId(2)
    const message = new QueryMessage(id, action, params, responseHandler, setTimeout(() => {
      this.messageTable.remove(id)
    }, this.config.messageTimeout))
    
    this.messageTable.set(id, message)
    return message
  }

  addNodes(nodesBin) {
    const nodes = ResponseMessage.parseNodes(nodesBin)
    nodes.map(n => this.addNode(n))
  }

  addNode(node) {
    allNodes = this.routeTable.toArray()
		if (allNodes.length > this.config.maxRouteTableLen) return

		const existNode = this.routeTable.get(node.id)

		if(existNode) {
      existNode.lastActive = Date.now()
      return
    }
    
    if(KBucket.distance(node.id, this.nodeId) != 0) {
			node.lastActive = Date.now()
			node.pingInterval = setInterval(() => {
						this.ping(node)
      }, this.config.pingInterval)
			node.checkInterval = setInterval(() => {
				if(Date.now() - node.lastActive > 3 * this.config.pingInterval) {
					clearInterval(node.pingInterval)
					clearInterval(node.checkInterval)
          this.routeTable.remove(node.id)
        }
      }, 3 * this.config.pingInterval)

      this.routeTable.add(node)
    }
  }

  static generateId(len) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    const text = Array.from(Array(len).keys()).map(i => chars.charAt(Math.floor((Math.random() * chars.length))))
    return text.join('')
  }
}