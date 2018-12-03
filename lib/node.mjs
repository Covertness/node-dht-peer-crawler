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
    this.announceInfoHashes = new Set()
    this.workInfoHashes = new Set()
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

  refreshToken(token) {
    this.token = token
  }

  announceInfoHashesAdd(infoHashStr) {
    this.announceInfoHashes.add(infoHashStr)
  }

  workInfoHashesAdd(infoHashStr) {
    this.workInfoHashes.add(infoHashStr)
  }

  get working() {
    return this.announceInfoHashes.size < 10 || this.workInfoHashes.size > 0  // TODO: 10 need to be validated
  }

  calScore() {
    return parseInt((Date.now() - this.createdAt) / (1000 * 60)) + (this.workInfoHashes.size > 0 ? this.announceInfoHashes.size : 0) * 24 * 60
  }
}