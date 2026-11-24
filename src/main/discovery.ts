import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import type { AnnouncePacket, PeerIdentity } from '../shared/types'

const DEFAULT_GROUP = '239.255.42.99'
const DEFAULT_PORT = 47820
const ANNOUNCE_INTERVAL = 3000

export interface PeerSeen extends PeerIdentity {
  ip: string
  lastSeen: number
}

export class Discovery extends EventEmitter {
  private socket: dgram.Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly group = process.env.TASKPUSH_MULTICAST_GROUP || DEFAULT_GROUP
  private readonly basePort = Number(process.env.TASKPUSH_DISCOVERY_PORT) || DEFAULT_PORT
  private boundPort = this.basePort

  constructor(private readonly identity: () => PeerIdentity) {
    super()
  }

  get port(): number {
    return this.boundPort
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      this.socket = socket

      socket.on('error', (err) => {
        console.error('[discovery] socket error', err)
        if (!this.timer) reject(err)
      })

      socket.on('message', (buf, rinfo) => {
        let packet: AnnouncePacket
        try {
          packet = JSON.parse(buf.toString('utf8')) as AnnouncePacket
        } catch {
          return
        }
        if (packet.app !== 'taskdrop') return
        if (packet.deviceId === this.identity().deviceId) return

        if (packet.type === 'probe') {
          setTimeout(() => this.announce(), 40 + Math.random() * 160)
          return
        }
        if (packet.type !== 'announce') return

        this.emit('peer', {
          deviceId: packet.deviceId,
          name: packet.name,
          platform: packet.platform,
          port: packet.port,
          ip: rinfo.address,
          lastSeen: Date.now()
        } satisfies PeerSeen)
      })

      socket.bind(this.basePort, () => {
        try {
          socket.addMembership(this.group)
          socket.setMulticastTTL(1)
          socket.setMulticastLoopback(true)
        } catch (err) {
          console.error('[discovery] multicast setup failed, falling back to manual IP', err)
        }
        this.boundPort = socket.address().port
        this.announce()
        this.sendProbe()
        this.timer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL)
        resolve()
      })
    })
  }

  announce(): void {
    const packet: AnnouncePacket = {
      app: 'taskdrop',
      type: 'announce',
      ...this.identity(),
      ts: Date.now()
    }
    this.send(packet)
  }

  sendProbe(): void {
    const packet: AnnouncePacket = {
      app: 'taskdrop',
      type: 'probe',
      ...this.identity(),
      ts: Date.now()
    }
    this.send(packet)
  }

  private send(packet: AnnouncePacket): void {
    if (!this.socket) return
    const buf = Buffer.from(JSON.stringify(packet))
    this.socket.send(buf, 0, buf.length, this.basePort, this.group, (err) => {
      if (err) console.error('[discovery] send failed', err.message)
    })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    try {
      this.socket?.close()
    } catch {
      /* ignore */
    }
    this.socket = null
  }
}