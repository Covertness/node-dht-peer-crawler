import {TYPE, TYPE_CODE} from './lib/message'
import Crawler from './lib/crawler'

for (let key of Object.keys(TYPE)) {
  console.log(key, TYPE[key])
}

for (let key of Object.keys(TYPE_CODE)) {
  console.log(key, TYPE_CODE[key])
}

const crawler = new Crawler()
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