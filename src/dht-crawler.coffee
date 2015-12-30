KBucket = require 'k-bucket'
events = require 'events'
inherits = require 'inherits'
bencode = require 'bencode'
ht = require 'ht'
Set = require 'collections/set'
Network = require './dht-network'
dht = require './dht'

defaultOptions =
	listenPort: 6881
	messageTimeout: 60 * 1000
	pingInterval: 3 * 60 * 1000
	findInterval: 2 * 60 * 1000

module.exports =
	class DHTCrawler extends events.EventEmitter
		constructor: (options) ->
			@options = options || {}
			for o, v of defaultOptions
				if @options[o] == undefined
					@options[o] = v
				
			@routeTable = new KBucket
			@messageTable = new ht
			@infoHashTable = new ht

			@nodeId = @routeTable.localNodeId
			@token = @generateId 8

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

			bootstrapNode =
				id: new Buffer('')
				address:
					ip: 'router.bittorrent.com'
					port: 6881
				lastActive: Date.now()
				pingInterval: setInterval () =>
					@ping bootstrapNode
				, @options.pingInterval

			@routeTable.add bootstrapNode
			@findMoreNodes()                   # find once immediately
			@findInterval = setInterval () =>
				@findMoreNodes()
			, @options.findInterval


		findMoreNodes: () ->
			allNodes = @routeTable.toArray()

			console.log 'route table length', allNodes.length
			console.log 'info_hash table length', @infoHashTable.keys().length

			if allNodes.length > 1000
				console.log 'route table is overload'
				return

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

				nodesBin = resp.nodes
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

			@network.sendMessage message, remoteNode.address


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

				remoteNode.id = resp.id
				remoteNode.lastActive = Date.now()

			@network.sendMessage message, remoteNode.address


		handleQueryMessage: (message, address) ->
			if message.t == undefined or message.q == undefined or message.a == undefined
				console.log 'invalid query message'
				return

			query = message.q.toString()
			if query == 'ping'
				resp =
					t: message.t
					y: dht.typeCodes['response']
					r:
						id: @nodeId
				@network.sendMessage resp, address
			else if query == 'find_node'
				@handleFindNode message, address
			else if query == 'get_peers'
				@handleGetPeers message, address
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

			if @infoHashTable.contains(args.info_hash)
				torrent = @infoHashTable.get args.info_hash
				torrent.queryNodes.add(args.id)
				torrent.lastActive = Date.now()
			else
				torrent =
					queryNodes: new Set [args.id]
					lastActive: Date.now()
				@infoHashTable.put args.info_hash, torrent

			nodesBin = @getClosestNodesBin args.info_hash
			
			resp =
				t: message.t
				y: dht.typeCodes['response']
				r:
					id: @nodeId
					token: @token
					nodes: nodesBin
			@network.sendMessage resp, address


		registerQueryMessage: (message, messageHandler) ->
			messageHandlers =
				q: message.q
				handler: messageHandler
				timeoutHandler: setTimeout () =>
					@messageTable.remove(message.t)
				, @options.messageTimeout

			@messageTable.put message.t, messageHandlers


		addNode: (node) ->
			if node.id != @nodeId
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


		getClosestNodesBin: (nodeId) ->
			closestNodes = @routeTable.closest({id: nodeId}, 16)
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