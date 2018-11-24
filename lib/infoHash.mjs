import Emitter from 'events'

export default class InfoHash extends Emitter {
  constructor() {
    super()

    this.config = {
      infoHashTimeout: 30 * 60 * 1000
    }

    this.queryNodes = new Set()
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
    this.queryNodes.add(nodeIdStr)
  }

  queryNodesDelete(nodeIdStr) {
    this.queryNodes.delete(nodeIdStr)
  }
}