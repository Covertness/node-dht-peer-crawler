import fs from 'fs'
import KBucket from 'k-bucket'
import Network from '../lib/network'
import Node from '../lib/node'
import { TYPE, QueryMessage } from '../lib/message'
import Crawler from '../lib/crawler'
jest.mock('../lib/network')

beforeEach(() => {
  Network.mockClear()
})

it('network built after the crawler started', async () => {
  const crawler = new Crawler()
  await crawler.start()
  expect(Network).toHaveBeenCalledTimes(1)

  const networkInstance = Network.mock.instances[0]
  expect(networkInstance.build).toHaveBeenCalledTimes(1)

  await crawler.stop()
})

describe('message', () => {
  const address = {
    ip: '1.1.1.1',
    port: '6881'
  }
  const peer = address.ip + ':' + address.port
  const infoHash = new Buffer('95b26a83dc5c130584ca19b350c87fec9afda6bc', 'hex')

  let crawler
  beforeEach(async () => {
    crawler = new Crawler()
    await crawler.start()
    crawler.createQueryMessage = jest.fn((action, params) => new QueryMessage('tt', action, params))
  })

  afterEach(async () => {
    await crawler.stop()
  })

  describe('collection', () => {
    it('get_more_peers', () => {
      crawler.getPeers = jest.fn()

      crawler.addInfoHash(infoHash.toString('hex'))

      crawler.getMorePeers()
      expect(crawler.getPeers).toHaveBeenCalledTimes(1) // bootstrapNode
    })

    it('announce_peers', () => {
      crawler.announcePeer = jest.fn()

      crawler.addNode({ id: new Buffer('gw0S7yYnVtiC8A22GarM2RXsoo8=', 'base64'), address: address })
      const nodeWithToken = crawler.addNode({ id: new Buffer('AhEtNLOoSbSvIK4rW+gyWVmbsPI=', 'base64'), address: address })
      nodeWithToken.refreshToken('aoeusnth')

      crawler.announcePeers(infoHash.toString('hex'), address.port)
      expect(crawler.announcePeer).toHaveBeenCalledTimes(1)
    })
  })

  describe('send', () => {
    const remoteNode = new Node(
      new Buffer('AhEtNLOoSbSvIK4rW+gyWVmbsPI=', 'base64'),
      address,
      new Date()
    )
    remoteNode.refreshToken('aoeusnth')

    it('ping', () => {
      crawler.ping(remoteNode)

      const networkMethod = Network.mock.instances[0].sendMessage
      expect(networkMethod).toHaveBeenCalledTimes(1)

      const req = networkMethod.mock.calls[0][0]
      expect(req.type).toEqual(TYPE.q)
      expect(req.action).toEqual('ping')
      expect(req.params.id).toEqual(crawler.nodeId)

      const createQueryMessage = crawler.createQueryMessage
      expect(createQueryMessage).toHaveBeenCalledTimes(1)
      // call response handler
      createQueryMessage.mock.calls[0][2](remoteNode)
    })

    it('find_node', () => {
      crawler.findNode(remoteNode)

      const networkMethod = Network.mock.instances[0].sendMessage
      expect(networkMethod).toHaveBeenCalledTimes(1)

      const req = networkMethod.mock.calls[0][0]
      expect(req.type).toEqual(TYPE.q)
      expect(req.action).toEqual('find_node')
      expect(req.params.id).toEqual(crawler.nodeId)
      expect(req.params.target).toEqual(crawler.nodeId)

      const createQueryMessage = crawler.createQueryMessage
      expect(createQueryMessage).toHaveBeenCalledTimes(1)
      // call response handler
      createQueryMessage.mock.calls[0][2]({
        id: remoteNode.id, 
        nodes: QueryMessage.serializeNodes([remoteNode])
      })
    })

    it('get_peers', () => {
      const torrent = crawler.addInfoHash(infoHash.toString('hex'))
      crawler.getPeers(torrent, infoHash, remoteNode)

      const networkMethod = Network.mock.instances[0].sendMessage
      expect(networkMethod).toHaveBeenCalledTimes(1)

      const req = networkMethod.mock.calls[0][0]
      expect(req.type).toEqual(TYPE.q)
      expect(req.action).toEqual('get_peers')
      expect(req.params.id).toEqual(crawler.nodeId)
      expect(req.params.target).toEqual(infoHash)

      const createQueryMessage = crawler.createQueryMessage
      expect(createQueryMessage).toHaveBeenCalledTimes(1)
      // call response handler
      createQueryMessage.mock.calls[0][2]({
        id: remoteNode.id, 
        nodes: QueryMessage.serializeNodes([remoteNode])
      })
      createQueryMessage.mock.calls[0][2]({
        id: remoteNode.id, 
        values: QueryMessage.serializePeers([[peer, {address: peer}]])
      })
    })

    it('announce_peer', () => {
      crawler.announcePeer(infoHash, address.port, remoteNode)

      const networkMethod = Network.mock.instances[0].sendMessage
      expect(networkMethod).toHaveBeenCalledTimes(1)

      const req = networkMethod.mock.calls[0][0]
      expect(req.type).toEqual(TYPE.q)
      expect(req.action).toEqual('announce_peer')
      expect(req.params.id).toEqual(crawler.nodeId)
      expect(req.params.info_hash).toEqual(infoHash)
      expect(req.params.port).toEqual(address.port)
      expect(req.params.token).toEqual(remoteNode.token)

      const createQueryMessage = crawler.createQueryMessage
      expect(createQueryMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe('handler', () => {
    it('ping', () => {
      const message = crawler.createQueryMessage('ping', {
        id: crawler.nodeId
      })
      crawler.handleQueryMessage(message, address)

      const networkMethod = Network.mock.instances[0].sendMessage
      expect(networkMethod).toHaveBeenCalledTimes(1)

      const resp = networkMethod.mock.calls[0][0]
      expect(resp.type).toEqual(TYPE.r)
      expect(resp.id).toEqual(message.id)
      expect(resp.response.id).toEqual(crawler.nodeId)

      const respAddress = networkMethod.mock.calls[0][1]
      expect(respAddress).toEqual(address)
    })

    it('find_node', () => {
      const message = crawler.createQueryMessage('find_node', {
        id: crawler.nodeId,
        target: crawler.nodeId
      })
      crawler.handleQueryMessage(message, address)

      const networkMethod = Network.mock.instances[0].sendMessage
      expect(networkMethod).toHaveBeenCalledTimes(1)

      const resp = networkMethod.mock.calls[0][0]
      expect(resp.type).toEqual(TYPE.r)
      expect(resp.id).toEqual(message.id)
      expect(resp.response.id).toEqual(crawler.nodeId)

      const nodes = crawler.routeTable.closest(crawler.nodeId, 16)
      expect(resp.response.nodes).toEqual(QueryMessage.serializeNodes(nodes))

      const respAddress = networkMethod.mock.calls[0][1]
      expect(respAddress).toEqual(address)
    })

    describe('get_peers', () => {
      let message
      beforeEach(() => {
        message = crawler.createQueryMessage('get_peers', {
          id: crawler.nodeId,
          info_hash: infoHash
        })
      })

      it('got nodes', () => {
        crawler.handleQueryMessage(message, address)

        const networkMethod = Network.mock.instances[0].sendMessage
        expect(networkMethod).toHaveBeenCalledTimes(1)

        const resp = networkMethod.mock.calls[0][0]
        expect(resp.type).toEqual(TYPE.r)
        expect(resp.id).toEqual(message.id)
        expect(resp.response.id).toEqual(crawler.nodeId)
        expect(resp.response.token).toEqual(crawler.token)

        const nodes = crawler.routeTable.closest(infoHash, 16)
        expect(resp.response.nodes).toEqual(QueryMessage.serializeNodes(nodes))

        const respAddress = networkMethod.mock.calls[0][1]
        expect(respAddress).toEqual(address)
      })

      it('got peers', () => {
        const torrent = crawler.addInfoHash(infoHash.toString('hex'))
        torrent.announceNodesAdd(peer)

        crawler.handleQueryMessage(message, address)

        const networkMethod = Network.mock.instances[0].sendMessage
        expect(networkMethod).toHaveBeenCalledTimes(1)

        const resp = networkMethod.mock.calls[0][0]
        expect(resp.type).toEqual(TYPE.r)
        expect(resp.id).toEqual(message.id)
        expect(resp.response.id).toEqual(crawler.nodeId)
        expect(resp.response.token).toEqual(crawler.token)

        expect(resp.response.values).toEqual(QueryMessage.serializePeers([[peer, {address: peer}]]))

        const respAddress = networkMethod.mock.calls[0][1]
        expect(respAddress).toEqual(address)
      })
    })

    it('announce_peer', () => {
      const message = crawler.createQueryMessage('announce_peer', {
        id: crawler.nodeId,
        info_hash: infoHash,
        port: address.port
      })
      crawler.handleQueryMessage(message, address)

      const networkMethod = Network.mock.instances[0].sendMessage
      expect(networkMethod).toHaveBeenCalledTimes(1)

      const resp = networkMethod.mock.calls[0][0]
      expect(resp.type).toEqual(TYPE.r)
      expect(resp.id).toEqual(message.id)
      expect(resp.response.id).toEqual(crawler.nodeId)

      const respAddress = networkMethod.mock.calls[0][1]
      expect(respAddress).toEqual(address)
    })
  })
})

describe('peer data', () => {
  const peerData = [{
    id: 'AhEtNLOoSbSvIK4rW+gyWVmbsPI=',
    address: {
      ip: '1.1.1.1',
      port: 30225
    },
    createdAt: 1543154241400,
    announceNodesCount: 0
  }]

  let fsReadFile, fsWriteFile, crawler
  beforeAll(() => {
    fsReadFile = fs.readFile
    fsWriteFile = fs.writeFile
    fs.readFile = jest.fn((_p, _e, cb) => cb(null, JSON.stringify(peerData)))
    fs.writeFile = jest.fn()

    crawler = new Crawler()
    crawler.routeTable = new KBucket()
    crawler.nodeId = crawler.routeTable.localNodeId
  })

  afterAll(() => {
    fs.writeFile = fsWriteFile
    fs.readFile = fsReadFile
  })

  it('load last data', async () => {
    await crawler.loadLastRoutes()

    expect(crawler.routeTable.count()).toBe(1)

    const peer = crawler.routeTable.get(new Buffer(peerData[0].id, 'base64'))
    expect(peer.address).toEqual(peerData[0].address)
    expect(peer.createdAt).toBe(peerData[0].createdAt)
  })

  it('persistent data', () => {
    crawler.routeTable.add(new Node(
      new Buffer(peerData[0].id, 'base64'),
      peerData[0].address,
      peerData[0].createdAt
    ))
    crawler.persistentNodes()

    expect(fs.writeFile.mock.calls[0][1]).toBe(JSON.stringify(peerData))
  })
})