express = require 'express'
cors = require 'cors'
DHTCrawler = require './dht-crawler'
Restful = require './dht-restful'

app = express()
app.use cors()

port = process.env.PORT || 8080

dhtCrawler = new DHTCrawler

dhtCrawler.on 'listening', () =>
	console.log 'dht crawler started'

	Restful.setup app, dhtCrawler
	app.listen port
	console.log 'restful api on port', port