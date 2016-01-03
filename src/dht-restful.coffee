exports.setup = (app, dhtCrawler) ->
	app.get '/nodes', (req, res) =>
		res.json {nodes: dhtCrawler.getAllNodes()}

	app.get '/infos', (req, res) =>
		res.json {infos: dhtCrawler.getAllInfoHashs()}

	app.get '/torrent', (req, res) =>
		torrent = dhtCrawler.getTorrent req.query.info
		res.json torrent