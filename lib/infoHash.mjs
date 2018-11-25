import Emitter from 'events'
import QuickLRU from 'quick-lru'

export default class InfoHash extends Emitter {
  constructor() {
    super()

    this.config = {
      infoHashTimeout: 30 * 60 * 1000
    }

    this.queryNodes = new QuickLRU({maxSize: 5})   // TotalSize: 10
    this.announceNodes = new Set()
    this.lastActive = Date.now()
    this.checkInterval = setInterval(() => {
      if (Date.now() - this.lastActive >= this.config.infoHashTimeout) {
        this.destroy()
      }
    }, this.config.infoHashTimeout)
  }

  destroy() {
    clearInterval(this.checkInterval)
    this.emit('destroy')
  }

  refresh() {
    this.lastActive = Date.now()
  }

  queryNodesAdd(nodeIdStr) {
    this.queryNodes.set(nodeIdStr, nodeIdStr)
  }

  queryNodesDelete(nodeIdStr) {
    this.queryNodes.delete(nodeIdStr)
  }

  announceNodesAdd(addressStr) {
    this.announceNodes.add(addressStr)
    this.emit('announce', addressStr)
  }
}