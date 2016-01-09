integerRegex = /^[0-9]*$/

exports.setup = (app, dhtCrawler) ->
	app.get '/nodes', (req, res) =>
		res.json {nodes: dhtCrawler.getAllNodes()}

	app.get '/infos', (req, res) =>
		minAnnounceNodes = 
			if req.query.min_ann_nodes and integerRegex.test req.query.min_ann_nodes 
				req.query.min_ann_nodes 
			else
				1

		res.json {infos: dhtCrawler.getAllInfoHashs(minAnnounceNodes)}

	app.get '/torrent', (req, res) =>
		torrent = dhtCrawler.getTorrent req.query.info
		res.json torrent