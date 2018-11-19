export const TYPE = {
  q: 'query',
  r: 'response',
  e: 'error'
}

export const TYPE_CODE = {}
for (let key of Object.keys(TYPE)) {
  TYPE_CODE[TYPE[key]] = key
}

export class Message {
  static parse(msg) {
    switch (TYPE[msg.y]) {
      case TYPE.q: return new QueryMessage(msg.t, msg.q, msg.a)
      case TYPE.r: return new ResponseMessage(msg.t, msg.r)
      case TYPE.e: return new ErrorMessage(msg.t)
      default: {
        console.error('unknown message:')
        console.dir(msg, { depth: null })
        return
      }
    }
  }

  constructor(t, y) {
    this.t = t
    this.y = y
  }

  get id() {
    return this.t && this.t.toString()
  }
}

export class QueryMessage extends Message {
  constructor(id, action, params, responseHandler, timeout) {
    super(id, 'q')
    this.q = action
    this.a = params
    this.responseHandler = responseHandler
    this.timeout = timeout
  }

  get type() {
    return TYPE.q
  }

  get action() {
    return this.q && this.q.toString()
  }

  get params() {
    return this.a
  }

  serialize() {
    return {
      t: this.t,
      y: this.y,
      q: this.q,
      a: this.a
    }
  }

  static serializeNodes(nodes) {
    const nodesBin = new Buffer(nodes.length * 26)
    const pos = 0
    nodes.forEach(node => {
      node.id.copy(nodesBin, pos, 0, 20)
			const ip = node.address.ip.split('.')
			nodesBin[pos+20] = ip[0] | 0
			nodesBin[pos+21] = ip[1] | 0
			nodesBin[pos+22] = ip[2] | 0
			nodesBin[pos+23] = ip[3] | 0
			nodesBin[pos+24] = (node.address.port/256) | 0
			nodesBin[pos+25] = node.address.port%256
			pos += 26
    })

    return nodesBin
  }
}

export class ResponseMessage extends Message {
  constructor(id, response) {
    super(id, 'r')
    this.r = response
  }

  get type() {
    return TYPE.r
  }

  get response() {
    return this.r
  }

  serialize() {
    return {
      t: this.t,
      y: this.y,
      r: this.r
    }
  }

  static parseNodes(nodesBin) {
    if(nodesBin.length % 26 != 0) return []

    const ns = []
    for (let index = 0; index < nodesBin.length; index+=26) {
      ns.push({
        id: nodesBin.slice(index, index + 20),
        address: {
          ip: nodesBin[index + 20] + "." + nodesBin[index + 21] + "." + nodesBin[index + 22] + "." + nodesBin[index + 23],
          port: nodesBin.readUInt16BE(index + 24)
        }
      })
    }

    return ns
  }
}

export class ErrorMessage extends Message {
  constructor(id) {
    super(id, 'e')
  }

  get type() {
    return TYPE.e
  }

  serialize() {
    return {
      t: this.t,
      y: this.y
    }
  }
}