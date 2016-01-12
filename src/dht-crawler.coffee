KBucket = require 'k-bucket'
events = require 'events'
inherits = require 'inherits'
path = require 'path'
bencode = require 'bencode'
bncode = require 'bncode'
ht = require 'ht'
Map = require 'collections/map'
hll = require 'hll'
magnet = require 'magnet-uri'
pws = require 'peer-wire-swarm'
hat = require 'hat'
Network = require './dht-network'
dht = require './dht'
exchangeMetadata = require './torrent-exchange-metadata'

defaultOptions =
	listenPort: 6881
	messageTimeout: 60 * 1000
	pingInterval: 3 * 60 * 1000
	findInterval: 2 * 60 * 1000
	infoHashTimeout: 30 * 60 * 1000
	maxRouteTableLen: 1000
	maxInfoHashTableLen: 15000

module.exports =
	class DHTCrawler extends events.EventEmitter
		constructor: (options) ->
			@options = options || {}
			for o, v of defaultOptions
				if @options[o] == undefined
					@options[o] = v
				
			@routeTable = new KBucket
			@messageTable = new ht
			@infoHashTable = new Map {}

			@nodeId = @routeTable.localNodeId
			@token = @generateId 8
			@peerId = '-TS0008-' + hat(48)

			@network = new Network @options

			@network.on 'listening', @emit.bind(this, 'listening')
			@network.on 'net_error', @emit.bind(this, 'net_error')
			@network.on 'net_close', @emit.bind(this, 'net_close')
			@network.on 'data_error', @emit.bind(this, 'data_error')

			@network.on 'query', (message, address) =>
				@handleQueryMessage message, address

			@network.on 'response', (message, address) =>
				@handleResponseMessage message, address

			@network.on 'error', (message, address) =>
				@handleErrorMessage message, address

			@bootstrapNode =
				id: new Buffer('')
				address:
					ip: 'router.bittorrent.com'
					port: 6881
				lastActive: Date.now()
				pingInterval: setInterval () =>
					@ping @bootstrapNode
				, @options.pingInterval

			@routeTable.add @bootstrapNode

			@findMoreNodes(@routeTable.toArray())  # find once immediately

			@findInterval = setInterval () =>
				allNodes = @routeTable.toArray()

				console.log 'route table length', allNodes.length
				console.log 'info_hash table length', @infoHashTable.length

				if allNodes.length < @options.maxRouteTableLen
					@findMoreNodes(allNodes)
				else
					@getMorePeers()

			, @options.findInterval


		getAllNodes: () ->
			date = new Date()
			for node in @routeTable.toArray()
				date.setTime(node.lastActive)
				{ip: node.address.ip, lastActive: date.toUTCString()}


		getAllInfoHashs: (minAnnounceNodes) ->
			date = new Date()
			allAnnounceInfoHash = []
			for item in @infoHashTable.entries()
				infoHash = item[0]
				torrent = item[1]
				announceNodesLen = torrent.announceNodes.estimate()
				if announceNodesLen >= minAnnounceNodes
					allAnnounceInfoHash.push {
						infoHash: infoHash
						queryNodesNum: torrent.queryNodes.estimate()
						announceNodesNum: torrent.announceNodes.estimate()
					}
			allAnnounceInfoHash


		getTorrent: (infoHash) ->
			magnetLink = magnet.encode {
				xt: ['urn:btih:' + infoHash.toUpperCase()]
			}

			torrent = @infoHashTable.get infoHash, null
			if torrent != null and torrent.metadata != undefined
				name = 
					if torrent.metadata.name != undefined
						torrent.metadata.name.toString()
					else if torrent.metadata['name.utf-8'] != undefined
						torrent.metadata['name.utf-8'].toString()
					else
						''

				tpath =
					if torrent.metadata.files != undefined
						files = torrent.metadata.files
						files.map (file, i) =>
							parts = [].concat(name, file['path.utf-8'] || file.path || []).map (p) =>
								return p.toString()

							{
								path: path.join.apply(null, [path.sep].concat(parts)).slice(1)
								name: parts[parts.length - 1]
								length: file.length
							}
					else
						[]

				pieceLength = torrent.metadata['piece length'] || 0

				{
					magnet: magnetLink
					name: name
					path: tpath
					pieceLength: pieceLength
				}
			else
				{magnet: magnetLink}


		findMoreNodes: (allNodes) ->
			@findNode knownNode for knownNode in allNodes


		findNode: (remoteNode) ->
			message = 
				t: @generateId 2
				y: dht.typeCodes['query']
				q: 'find_node'
				a:
					id: @nodeId
					target: @nodeId

			@registerQueryMessage message, (resp, remoteAddress) =>
				if resp.id == undefined or resp.nodes == undefined
					return

				@addNodes resp.nodes

			@network.sendMessage message, remoteNode.address


		getMorePeers: () ->
			for item in @infoHashTable.entries()
				infoHash = item[0]

				closestNodes = @routeTable.closest({id: new Buffer(infoHash, 'hex')}, 16)
				for node in closestNodes
					@getPeers infoHash, node.address


		getPeers: (infoHash, remoteAddress) ->
			message =
				t: @generateId 2
				y: dht.typeCodes['query']
				q: 'get_peers'
				a:
					id: @nodeId
					target: infoHash

			@registerQueryMessage message, (resp, address) =>
				if resp.id == undefined
					return

				if resp.values != undefined
					peersBin = resp.values
					if peersBin.length % 6 != 0
						console.log 'invalid get_peers resp'
						return

					torrent = 
						if @infoHashTable.has infoHash
							@infoHashTable.get infoHash
						else
							@addInfoHash infoHash

					if torrent != undefined
						for i in [0..peersBin.length-1] by 6
							ipStr = nodesBin[i] + "." + nodesBin[i + 1] + "." + nodesBin[i + 2] + "." + nodesBin[i + 3]
							port = nodesBin.readUInt16BE(i + 4)
							addressStr = ipStr + ':' + port

							torrent.announceNodes.insert addressStr
							@addPeer infoHash, torrent, addressStr

						torrent.lastActive = Date.now()
				else if resp.nodes != undefined
					@addNodes resp.nodes

			@network.sendMessage message, remoteAddress


		ping: (remoteNode) ->
			message = 
				t: @generateId 2
				y: dht.typeCodes['query']
				q: 'ping'
				a:
					id: @nodeId

			@registerQueryMessage message, (resp, remoteAddress) =>
				if resp.id == undefined
					console.log 'invalid ping resp'
					return

				if KBucket.distance(remoteNode.id, resp.id) == 0
					remoteNode.lastActive = Date.now()
				else if remoteNode == @bootstrapNode
					remoteNode.id = resp.id
					remoteNode.lastActive = Date.now()
					@routeTable.remove remoteNode
					@routeTable.add remoteNode

			@network.sendMessage message, remoteNode.address


		handleQueryMessage: (message, address) ->
			if message.t == undefined or message.q == undefined or message.a == undefined
				console.log 'invalid query message'
				return

			query = message.q.toString()
			if query == 'ping'
				@handlePing message, address
			else if query == 'find_node'
				@handleFindNode message, address
			else if query == 'get_peers'
				@handleGetPeers message, address
			else if query == 'announce_peer'
				@handleAnnouncePeer message, address
			else
				console.log 'receive query message', query, 'from', address.ip


		handleResponseMessage: (message, address) ->
			if message.t == undefined or message.r == undefined
				return

			transactionId = message.t.toString()
			if !@messageTable.contains(transactionId)
				return

			messageHandlers = @messageTable.get transactionId
			clearTimeout messageHandlers.timeoutHandler

			messageHandlers.handler message.r, address
			@messageTable.remove transactionId


		handleErrorMessage: (message, address) ->
			console.log 'receive error message', message, 'from', address.ip


		handlePing: (message, address) ->
			resp =
				t: message.t
				y: dht.typeCodes['response']
				r:
					id: @nodeId
			@network.sendMessage resp, address


		handleFindNode: (message, address) ->
			args = message.a
			if args.id == undefined or args.target == undefined
				console.log 'invaild find_node message'
				return

			remoteNode =
				id: args.id
				address: address
			@addNode remoteNode

			nodesBin = @getClosestNodesBin args.target
			
			resp =
				t: message.t
				y: dht.typeCodes['response']
				r:
					id: @nodeId
					nodes: nodesBin
			@network.sendMessage resp, address


		handleGetPeers: (message, address) ->
			args = message.a
			if args.id == undefined or args.info_hash == undefined
				console.log 'invaild get_peers message'
				return

			infoHashStr = args.info_hash.toString 'hex'
			torrent = 
				if @infoHashTable.has infoHashStr
					@infoHashTable.get infoHashStr
				else
					@addInfoHash infoHashStr

			if torrent != undefined
				torrent.queryNodes.insert args.id.toString 'hex'
				torrent.lastActive = Date.now()

			nodesBin = @getClosestNodesBin args.info_hash
			
			resp =
				t: message.t
				y: dht.typeCodes['response']
				r:
					id: @nodeId
					token: @token
					nodes: nodesBin
			@network.sendMessage resp, address


		handleAnnouncePeer: (message, address) ->
			args = message.a
			if args.id == undefined or args.info_hash == undefined or args.port == undefined
				console.log 'invaild get_peers message'
				return

			infoHashStr = args.info_hash.toString 'hex'
			torrent = 
				if @infoHashTable.has infoHashStr
					@infoHashTable.get infoHashStr
				else
					@addInfoHash infoHashStr

			if torrent != undefined
				ipStr = address.ip
				port = if args.implied_port != undefined and args.implied_port == 1
					address.port
				else
					args.port
				addressStr = ipStr + ':' + port

				torrent.announceNodes.insert addressStr
				torrent.lastActive = Date.now()
				@addPeer infoHashStr, torrent, addressStr

			resp =
				t: message.t
				y: dht.typeCodes['response']
				r:
					id: @nodeId
			@network.sendMessage resp, address

		registerQueryMessage: (message, messageHandler) ->
			messageHandlers =
				q: message.q
				handler: messageHandler
				timeoutHandler: setTimeout () =>
					@messageTable.remove(message.t)
				, @options.messageTimeout

			@messageTable.put message.t, messageHandlers


		addNodes: (nodesBin) ->
			if nodesBin.length % 26 != 0
				console.log 'invalid find_node resp'
				return

			for i in [0..nodesBin.length-1] by 26
				n = {
					id: nodesBin.slice(i, i + 20)
					address:
						ip: nodesBin[i + 20] + "." + nodesBin[i + 21] + "." + nodesBin[i + 22] + "." + nodesBin[i + 23]
						port: nodesBin.readUInt16BE(i + 24)
				}

				@addNode n


		addNode: (node) ->
			allNodes = @routeTable.toArray()

			if allNodes.length > @options.maxRouteTableLen
				return

			existNode = @routeTable.get node.id

			if existNode == null
				if KBucket.distance(node.id, @nodeId) != 0
					node.lastActive = Date.now()
					node.pingInterval = setInterval () =>
						@ping node
					, @options.pingInterval
					node.checkInterval = setInterval () =>
						if Date.now() - node.lastActive > 3 * @options.pingInterval
							clearInterval node.pingInterval
							clearInterval node.checkInterval
							@routeTable.remove node
					, 3 * @options.pingInterval

					@routeTable.add node
			else
				existNode.lastActive = Date.now()


		addInfoHash: (infoHash) ->
			if @infoHashTable.length > @options.maxInfoHashTableLen
				return undefined

			torrent =
				queryNodes: hll()
				announceNodes: hll()
				lastActive: Date.now()
				checkInterval: setInterval () =>
					if Date.now() - torrent.lastActive >= @options.infoHashTimeout
						clearInterval torrent.checkInterval
						torrent.swarm and torrent.swarm.destroy()
						@infoHashTable.delete infoHash
				, @options.infoHashTimeout

			@infoHashTable.set infoHash, torrent
			torrent


		addPeer: (infoHash, torrent, peerAddress) ->
			if torrent.swarm == undefined
				torrent.swarm = pws infoHash, @peerId
				exchange = exchangeMetadata infoHash, (metadata) =>
					torrent.metadata = bncode.decode metadata
					console.log infoHash, 'got metadata'
					torrent.swarm.destroy()

				torrent.swarm.on 'wire', (wire) =>
					exchange(wire)

			torrent.swarm.add peerAddress


		getClosestNodesBin: (id) ->
			closestNodes = @routeTable.closest({id: id}, 16)
			nodesBin = new Buffer(closestNodes.length * 26)
			pos = 0
			for node in closestNodes
				node.id.copy nodesBin, pos, 0, 20
				ip = node.address.ip.split '.'
				nodesBin[pos+20] = ip[0] | 0
				nodesBin[pos+21] = ip[1] | 0
				nodesBin[pos+22] = ip[2] | 0
				nodesBin[pos+23] = ip[3] | 0
				nodesBin[pos+24] = (node.address.port/256) | 0
				nodesBin[pos+25] = node.address.port%256
				pos += 26

			nodesBin


		generateId: (len) ->
			text = []
			chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZab" + "cdefghijklmnopqrstuvwxyz0123456789"
			for i in [0..len-1]
				text.push chars.charAt Math.floor (Math.random() * chars.length)

			text.join ""