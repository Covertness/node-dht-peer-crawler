# node-dht-broker
A broker relay the dht messages to clients over HTTP.

## Start
```bash
$ apt-get install nodejs npm make g++
$ make init
$ make build
$ node lib/dht-broker.js
```

## HTTP API
### Get Nodes
```bash
$ curl http://127.0.0.1:8080/nodes
```

### Get InfoHash
```bash
$ curl http://127.0.0.1:8080/infos
```

### Get Torrent
```bash
$ curl http://127.0.0.1:8080/torrent?info=torrent_infohash
```