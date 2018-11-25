import Emitter from 'events'

export default class Node extends Emitter {
  constructor(id, address, createdAt) {
    super()

    this.config = {
      pingInterval: 3 * 60 * 1000
    }

    this.id = id
    this.address = address
    this.createdAt = createdAt

    this.lastActive = Date.now()
    if (!this.createdAt) this.createdAt = Date.now()
    this.announceNodes = new Set()
  }

  init(needCheck) {
    this.pingInterval = setInterval(() => this.emit('ping'), this.config.pingInterval)

    if (needCheck) {
      this.checkInterval = setInterval(() => {
        if (Date.now() - this.lastActive > 3 * this.config.pingInterval) {
          this.destroy()
        }
      }, 3 * this.config.pingInterval)
    }
  }

  destroy() {
    this.pingInterval && clearInterval(this.pingInterval)
    this.checkInterval && clearInterval(this.checkInterval)
    this.emit('destroy')
  }

  refresh() {
    this.lastActive = Date.now()
  }

  calNodeScore() {
    return parseInt((Date.now() - this.createdAt) / (1000 * 60)) + this.announceNodes.size * 60
  }
}