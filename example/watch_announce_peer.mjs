import Crawler from '..'

const crawler = new Crawler()

crawler.on('announce_peer', (infoHashStr, addressStr) => {
  console.log(`got a peer ${addressStr} on ${infoHashStr}`)
})

crawler.on('_find_once', () => {
  console.log(`route table length: ${crawler.routeTable.count()}`)
  console.log(`info_hash table length: ${crawler.infoHashTable.size}`)
  let foundInfoHashCount = 0
  let queriedInfoHashCount = 0
  crawler.infoHashTable.forEach(info => {
    foundInfoHashCount += info.announceNodes.size
    queriedInfoHashCount += info.queryNodes.size
  })
  console.log(`found info_hash length: ${foundInfoHashCount}`)
  console.log(`queried info_hash length: ${queriedInfoHashCount}`)
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