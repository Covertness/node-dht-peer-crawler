# node-dht-peer-crawler

[![Travis Build Status](https://travis-ci.com/Covertness/node-dht-peer-crawler.svg?branch=master)](https://travis-ci.com/Covertness/node-dht-peer-crawler)
[![Coverage Status](https://coveralls.io/repos/github/Covertness/node-dht-peer-crawler/badge.svg?branch=master)](https://coveralls.io/github/Covertness/node-dht-peer-crawler?branch=master)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![npm version](https://badge.fury.io/js/dht-peer-crawler.svg)](http://badge.fury.io/js/dht-peer-crawler)
![Downloads](https://img.shields.io/npm/dm/dht-peer-crawler.svg?style=flat)

A fast and stable DHT crawler.

## Installation
```bash
$ npm install dht-peer-crawler
```

## Usage
```js
import Crawler from 'dht-peer-crawler'

const crawler = new Crawler()

crawler.on('announce_peer', (infoHashStr, addressStr) => {
  console.log(`got a peer ${addressStr} on ${infoHashStr}`)
})

crawler.start().then(() => {
  console.log('start crawler success')
}, (error) => {
  console.error(`start crawler failed: ${error}`)
})

const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2']

signalTraps.map(type => {
  process.once(type, async () => {
    try {
      await crawler.stop()
      console.log('stop crawler success')
    } finally {
      process.kill(process.pid, type)
    }
  })
})
```

## Test
```bash
$ npm test
```

## API
#### `crawler = new Crawler(listenPort)`

Create a new crawler instance.

#### `crawler.announcePeers(infoHashStr, port)`

announce the peer.

#### `crawler.on('announce_peer', [infoHashStr, addressStr, impliedPort, torrent])`

Emitted when received an `announce_peer` message.

#### `crawler.on('new_info_hash', [infoHashStr])`

Emitted when find a new `info_hash`.