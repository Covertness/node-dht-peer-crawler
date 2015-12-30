DHTCrawler = require './dht-crawler'

dhtCrawler = new DHTCrawler

dhtCrawler.on 'listening', () =>
	console.log 'dht crawler started'