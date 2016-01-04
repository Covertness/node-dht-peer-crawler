dgram = require 'dgram'
events = require 'events'
inherits = require 'inherits'
bencode = require 'bencode'
dht = require './dht'

module.exports =
	class DHTNetwork extends events.EventEmitter
		constructor: (@options) ->
			@udpSocket = dgram.createSocket {type: 'udp4', reuseAddr: false}

			@udpSocket.on 'error', (err) =>
				@emit 'net_error', err

			@udpSocket.on 'close', () =>
				@emit 'net_close'

			@udpSocket.on 'listening', () =>
				@emit 'listening'

			@udpSocket.on 'message', (data, remote) =>
				try
					message = bencode.decode(data)
				catch e
					@emit 'data_error', 'decode error'
					return

				if dht.types[message.y] == undefined
					@emit 'data_error', 'unknown message type'
					return
				
				@emit dht.types[message.y], message, {ip: remote.address, port: remote.port}

			@udpSocket.bind @options.listenPort

		sendMessage: (message, address) ->
			if address.port > 0 and address.port < 65536
				data = bencode.encode message
				@udpSocket.send data, 0, data.length, address.port, address.ip

		close: () ->
			@udpSocket.close