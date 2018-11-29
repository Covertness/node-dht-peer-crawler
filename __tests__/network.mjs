import Network from '../lib/network'
import { ResponseMessage } from '../lib/message'

let network
beforeEach(async () => {
  network = new Network()
  await network.build()
})

afterEach(async () => {
  await network.destroy()
})

it('send message with valid port', () => {
  network.udpSocket.send = jest.fn()
  const message = new ResponseMessage('tt')
  network.sendMessage(message, {ip: '1.1.1.1', port: 6881})

  expect(network.udpSocket.send).toHaveBeenCalledTimes(1)
})

it('send message with invalid port', () => {
  network.udpSocket.send = jest.fn()
  const message = new ResponseMessage('tt')
  network.sendMessage(message, {ip: '1.1.1.1', port: 68811})

  expect(network.udpSocket.send).toHaveBeenCalledTimes(0)
})