import Mixpanel from 'mixpanel'
import Crawler from './lib/crawler'

const mixpanel = Mixpanel.init(process.env.MIXPANEL_TOKEN, {
  protocol: 'https'
});

const crawler = new Crawler()
crawler.on('new_info_hash', (infoHashStr) => {
  mixpanel.track('new_info_hash', {
    distinct_id: infoHashStr
  });
})

crawler.on('announce_peer', (infoHashStr, addressStr) => {
  mixpanel.track('announce_peer', {
    distinct_id: infoHashStr,
    ip: addressStr.split(':')[0]
  });
})

crawler.start().then(() => {
  console.log('start crawler success')
}, (error) => {
  console.error(`start crawler failed: ${error}`)
})

const errorTypes = ['unhandledRejection', 'uncaughtException']
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2']

// errorTypes.map(type => {
//   process.on(type, async () => {
//     try {
//       await crawler.stop()
//       console.log('stop crawler success')
//       process.exit(0)
//     } catch (_) {
//       process.exit(1)
//     }
//   })
// })

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