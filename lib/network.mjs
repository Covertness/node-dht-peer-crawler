import Emitter from 'events'
import dgram from 'dgram'
import bencode from 'bencode'
import { Message } from './message'

export default class Network extends Emitter {
  constructor(listenPort) {
    super()

    this.listenPort = listenPort || 6881

    this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: false })

    this.udpSocket.on('error', (err) => {
      if (this.errorCB) this.errorCB(err)
    })

    this.udpSocket.on('close', () => {
      if (this.closeCB) this.closeCB()
    })

    this.udpSocket.on('listening', () => {
      if (this.listenCB) this.listenCB()
    })

    this.udpSocket.on('message', (data, remote) => {
      let message
      try {
        message = bencode.decode(data)
      } catch (e) {
        // console.error(`decode error: ${data}`)
        return
      }

      const msg = Message.parse(message, remote)
      if (!msg) return
      
      if (msg) this.emit('message', msg, {ip: remote.address, port: remote.port})
    })
  }

  async build() {
    return new Promise((resolve, reject) => {
      this.errorCB = (error) => {
        reject(error)
      }

      this.listenCB = () => {
        resolve()
      }

      this.udpSocket.bind(this.listenPort)
    })
  }

  sendMessage(message, address) {
    if(address.port < 0 || address.port > 65536) return
    
    const data = bencode.encode(message.serialize())

    this.udpSocket.send(data, 0, data.length, address.port, address.ip)
  }

  async destroy() {
    return new Promise((resolve, reject) => {
      this.udpSocket.close(() => {
        resolve()
      })
    })
  }
}