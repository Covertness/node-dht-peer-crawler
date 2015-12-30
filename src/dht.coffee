exports.types = 
	q: 'query'
	r: 'response'
	e: 'error'

exports.typeCodes = {}
for k, v of exports.types
	exports.typeCodes[v] = k