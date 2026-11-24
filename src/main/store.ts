import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Task } from '../shared/types'

export interface StoredPeer {
  id: string
  name: string
  alias: string
  platform: string
  ip: string
  port: number
  manual: boolean
}

interface Config {
  deviceId: string
  deviceName: string
}

interface PersistedData {
  config: Config
  peers: StoredPeer[]
  tasks: Task[]
}

const EMPTY: PersistedData = {
  config: { deviceId: '', deviceName: '' },
  peers: [],
  tasks: []
}

function defaultDeviceName(): string {
  const fromEnv = process.env.TASKPUSH_DEVICE_NAME?.trim()
  if (fromEnv) return fromEnv
  return os.hostname().replace(/\.local$/i, '') || '未命名设备'
}

export class Store {
  readonly dataDir: string
  readonly attachmentsDir: string
  private readonly file: string
  private data: PersistedData
  private saveTimer: NodeJS.Timeout | null = null

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.attachmentsDir = path.join(dataDir, 'attachments')
    this.file = path.join(dataDir, 'data.json')
    fs.mkdirSync(this.attachmentsDir, { recursive: true })

    let parsed: Partial<PersistedData> = {}
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<PersistedData>
    } catch {
      parsed = {}
    }

    this.data = {
      config: {
        deviceId: parsed.config?.deviceId || randomUUID(),
        deviceName: parsed.config?.deviceName || defaultDeviceName()
      },
      peers: Array.isArray(parsed.peers) ? parsed.peers : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
    }
    this.saveNow()
  }

  get config(): Config {
    return this.data.config
  }

  setDeviceName(name: string): void {
    const clean = name.trim()
    if (!clean) return
    this.data.config.deviceName = clean
    this.scheduleSave()
  }

  get peers(): StoredPeer[] {
    return this.data.peers
  }

  upsertPeer(peer: Partial<StoredPeer> & { id: string }): StoredPeer {
    let existing = this.data.peers.find((p) => p.id === peer.id)
    if (!existing) {
      existing = {
        id: peer.id,
        name: peer.name || '未知设备',
        alias: peer.alias || '',
        platform: peer.platform || '',
        ip: peer.ip || '',
        port: peer.port || 0,
        manual: peer.manual ?? false
      }
      this.data.peers.push(existing)
    } else {
      if (peer.name) existing.name = peer.name
      if (peer.platform) existing.platform = peer.platform
      if (peer.ip) existing.ip = peer.ip
      if (peer.port) existing.port = peer.port
      if (peer.manual) existing.manual = true
    }
    this.scheduleSave()
    return existing
  }

  setAlias(deviceId: string, alias: string): void {
    const peer = this.data.peers.find((p) => p.id === deviceId)
    if (!peer) return
    peer.alias = alias.trim()
    this.scheduleSave()
  }

  removePeer(deviceId: string): void {
    this.data.peers = this.data.peers.filter((p) => p.id !== deviceId)
    this.scheduleSave()
  }

  get tasks(): Task[] {
    return this.data.tasks
  }

  getTask(id: string): Task | undefined {
    return this.data.tasks.find((t) => t.id === id)
  }

  upsertTask(task: Task): void {
    const index = this.data.tasks.findIndex((t) => t.id === task.id)
    if (index >= 0) this.data.tasks[index] = task
    else this.data.tasks.push(task)
    this.scheduleSave()
  }

  removeTask(id: string): void {
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id)
    this.scheduleSave()
  }

  scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 120)
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    fs.mkdirSync(this.dataDir, { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }
}

export function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'file'
}

export function guessMime(name: string): string {
  const ext = path.extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.log': 'text/plain',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime'
  }
  return map[ext] || 'application/octet-stream'
}