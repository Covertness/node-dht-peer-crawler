import Network from '../lib/network'
import { TYPE } from '../lib/message'
import Crawler from '../lib/crawler'
jest.mock('../lib/network')

beforeEach(() => {
  Network.mockClear()
})

it('network built after the crawler started', async () => {
  const crawler = new Crawler()
  await crawler.start()
  expect(Network).toHaveBeenCalledTimes(1)

  const networkInstance = Network.mock.instances[0]
  expect(networkInstance.build).toHaveBeenCalledTimes(1)

  await crawler.stop()
})

describe('query message handler', () => {
  let crawler
  const address = {
    ip: '1.1.1.1',
    port: '6881'
  }
  beforeEach(async () => {
    crawler = new Crawler()
    await crawler.start()
  })

  afterEach(async () => {
    await crawler.stop()
  })

  it('ping', async () => {
    const message = crawler.createQueryMessage('ping', {
      id: crawler.nodeId
    })
    crawler.handlePing(message, address)

    const networkMethod = Network.mock.instances[0].sendMessage
    expect(networkMethod).toHaveBeenCalledTimes(1)

    const resp = networkMethod.mock.calls[0][0]
    expect(resp.type).toEqual(TYPE.r)
    expect(resp.id).toEqual(message.id)
    expect(resp.response.id).toEqual(crawler.nodeId)

    const respAddress = networkMethod.mock.calls[0][1]
    expect(respAddress).toEqual(address)
  })
})