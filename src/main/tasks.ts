import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Attachment, SelfInfo, Task, TaskDirection, TaskInput, TaskStatus } from '../shared/types'
import { Store, guessMime, safeFileName } from './store'
import type { StoredPeer } from './store'
import type { AttachmentSource } from './server'

export interface TaskServiceDeps {
  store: Store
  self: () => SelfInfo
  findPeer: (deviceId: string) => StoredPeer | undefined
  isOnline: (deviceId: string) => boolean
  emit: () => void
}

function baseUrl(ip: string, port: number): string {
  return `http://${ip.includes(':') ? `[${ip}]` : ip}:${port}`
}

async function postJson(url: string, body: unknown, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json().catch(() => null)
}

export class TaskService {
  private readonly downloading = new Set<string>()

  constructor(private readonly deps: TaskServiceDeps) {}

  private get store(): Store {
    return this.deps.store
  }

  self(): SelfInfo {
    return this.deps.self()
  }

  listTasks(): Task[] {
    return this.store.tasks
      .filter((t) => !t.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  createOrUpdate(input: TaskInput, taskId?: string): Task {
    const now = Date.now()
    const self = this.self()

    if (taskId) {
      const existing = this.store.getTask(taskId)
      if (!existing || existing.status !== 'draft') throw new Error('只能修改草稿')
      const updated: Task = {
        ...existing,
        mode: input.mode,
        title: input.title,
        description: input.description,
        attachments: input.attachments,
        revision: existing.revision + 1,
        updatedAt: now
      }
      this.store.upsertTask(updated)
      this.deps.emit()
      return updated
    }

    const task: Task = {
      id: randomUUID(),
      mode: input.mode,
      title: input.title,
      description: input.description,
      status: 'draft',
      direction: 'local',
      senderId: self.id,
      senderName: self.name,
      senderPort: self.port,
      receiverId: null,
      receiverName: null,
      attachments: input.attachments,
      unread: false,
      deleted: false,
      revision: 1,
      createdAt: now,
      updatedAt: now
    }
    this.store.upsertTask(task)
    this.deps.emit()
    return task
  }

  async sendTask(taskId: string, peerId: string): Promise<Task> {
    const existing = this.store.getTask(taskId)
    if (!existing) throw new Error('任务不存在')
    if (existing.direction !== 'local' || existing.status !== 'draft') throw new Error('只有草稿可以投递')
    const peer = this.deps.findPeer(peerId)
    if (!peer) throw new Error('设备不存在')
    if (!this.deps.isOnline(peerId)) throw new Error(`${peer.alias || peer.name} 当前离线`)

    const self = this.self()
    const outgoing: Task = {
      ...existing,
      status: 'active',
      direction: 'out',
      senderId: self.id,
      senderName: self.name,
      senderPort: self.port,
      receiverId: peer.id,
      receiverName: peer.alias || peer.name,
      unread: false,
      revision: existing.revision + 1,
      updatedAt: Date.now()
    }

    await postJson(`${baseUrl(peer.ip, peer.port)}/api/tasks`, { task: outgoing })

    const merged = this.mergeTask(this.store.getTask(taskId), outgoing)
    this.store.upsertTask(merged)
    this.deps.emit()
    return merged
  }

  setStatus(taskId: string, status: TaskStatus): Task {
    const task = this.store.getTask(taskId)
    if (!task) throw new Error('任务不存在')
    if (task.status === 'draft') throw new Error('草稿还没有投递')
    if (task.status === status) return task

    const updated: Task = {
      ...task,
      status,
      unread: false,
      revision: task.revision + 1,
      updatedAt: Date.now()
    }
    this.store.upsertTask(updated)
    this.deps.emit()
    this.pushToCounterpart(updated)
    return updated
  }

  markRead(taskId: string): void {
    const task = this.store.getTask(taskId)
    if (!task || !task.unread) return
    task.unread = false
    this.store.upsertTask(task)
    this.deps.emit()
  }

  deleteTask(taskId: string): void {
    const task = this.store.getTask(taskId)
    if (!task) return

    const neverSent = task.direction === 'local' || task.status === 'draft'
    if (neverSent) {
      this.removeFiles(task)
      this.store.removeTask(task.id)
      this.deps.emit()
      return
    }

    const tombstone: Task = {
      ...task,
      deleted: true,
      unread: false,
      revision: task.revision + 1,
      updatedAt: Date.now()
    }
    this.removeFiles(task)
    this.store.upsertTask(tombstone)
    this.deps.emit()
    this.pushToCounterpart(tombstone)
  }

  async receiveTask(task: Task, ip: string): Promise<void> {
    const existing = this.store.getTask(task.id)
    const merged = this.mergeTask(existing, task)
    this.store.upsertTask(merged)
    if (merged.deleted) this.removeFiles(merged)
    this.deps.emit()

    if (!merged.deleted && (!existing || merged.updatedAt === task.updatedAt)) {
      void this.downloadMissing(merged, ip, task.senderPort)
    }
  }

  async syncIncoming(tasks: Task[], peerId: string, ip: string): Promise<Task[]> {
    const peer = this.deps.findPeer(peerId)
    const port = peer?.port

    for (const remote of tasks) {
      const existing = this.store.getTask(remote.id)
      const merged = this.mergeTask(existing, remote)
      this.store.upsertTask(merged)
      if (merged.deleted) this.removeFiles(merged)
      else if (merged.direction === 'in') void this.downloadMissing(merged, ip, remote.senderPort || port)
    }
    this.deps.emit()

    return this.store.tasks
      .filter((t) => t.status !== 'draft' && (t.senderId === peerId || t.receiverId === peerId))
      .map((t) => ({ ...t, attachments: t.attachments.map((a) => ({ ...a, file: '' })) }))
  }

  async syncWithPeer(peerId: string): Promise<void> {
    const peer = this.deps.findPeer(peerId)
    if (!peer || !this.deps.isOnline(peerId)) return

    const mine = this.store.tasks
      .filter(
        (t) => t.status !== 'draft' && (t.senderId === peerId || t.receiverId === peerId)
      )
      .map((t) => ({ ...t, attachments: t.attachments.map((a) => ({ ...a, file: '' })) }))

    const result = (await postJson(`${baseUrl(peer.ip, peer.port)}/api/sync`, {
      deviceId: this.self().id,
      port: this.self().port,
      tasks: mine
    })) as { tasks?: Task[] } | null

    if (!Array.isArray(result?.tasks)) return
    for (const remote of result.tasks) {
      const existing = this.store.getTask(remote.id)
      const merged = this.mergeTask(existing, remote)
      this.store.upsertTask(merged)
      if (merged.deleted) this.removeFiles(merged)
      else if (merged.direction === 'in') void this.downloadMissing(merged, peer.ip, remote.senderPort || peer.port)
    }
    this.deps.emit()
  }

  addAttachmentFiles(paths: string[]): Attachment[] {
    const result: Attachment[] = []
    for (const source of paths) {
      try {
        const stat = fs.statSync(source)
        if (!stat.isFile()) continue
        const name = path.basename(source)
        const id = randomUUID()
        const fileName = `${id}-${safeFileName(name)}`
        const rel = path.join('attachments', fileName)
        fs.copyFileSync(source, path.join(this.store.dataDir, rel))
        result.push({ id, name, size: stat.size, mime: guessMime(name), file: rel })
      } catch (err) {
        console.error('[attachments] copy failed', source, err)
      }
    }
    return result
  }

  removeAttachmentFile(attachment: Attachment): void {
    if (!attachment.file) return
    try {
      fs.unlinkSync(path.join(this.store.dataDir, attachment.file))
    } catch {
      /* ignore */
    }
  }

  resolveAttachment(taskId: string, attId: string): AttachmentSource | null {
    const task = this.store.getTask(taskId)
    const attachment = task?.attachments.find((a) => a.id === attId)
    if (!task || !attachment || !attachment.file) return null
    return {
      absPath: path.join(this.store.dataDir, attachment.file),
      name: attachment.name,
      mime: attachment.mime || 'application/octet-stream'
    }
  }

  private pushToCounterpart(task: Task): void {
    const peerId = task.senderId === this.self().id ? task.receiverId : task.senderId
    if (!peerId) return
    const peer = this.deps.findPeer(peerId)
    if (!peer || !this.deps.isOnline(peerId)) return
    void postJson(`${baseUrl(peer.ip, peer.port)}/api/sync`, {
      deviceId: this.self().id,
      port: this.self().port,
      tasks: [{ ...task, attachments: task.attachments.map((a) => ({ ...a, file: '' })) }]
    }).catch((err) => console.error('[sync] push failed', err.message))
  }

  private mergeTask(local: Task | undefined, remote: Task): Task {
    const direction: TaskDirection = remote.senderId === this.self().id ? 'out' : 'in'

    if (!local) {
      return { ...remote, direction, unread: direction === 'in' }
    }

    const remoteWins =
      remote.updatedAt > local.updatedAt ||
      (remote.updatedAt === local.updatedAt && remote.revision > local.revision) ||
      (remote.updatedAt === local.updatedAt && remote.revision === local.revision && remote.deleted && !local.deleted)

    const winner = remoteWins ? remote : local
    const attachments = winner.attachments.map((candidate) => {
      const localCopy = local.attachments.find((a) => a.id === candidate.id)
      return localCopy?.file ? { ...candidate, file: localCopy.file } : candidate
    })

    return {
      ...winner,
      direction,
      attachments,
      unread: local.unread
    }
  }

  private async downloadMissing(task: Task, ip: string, port?: number): Promise<void> {
    if (task.deleted || !port) return
    for (const attachment of task.attachments) {
      if (attachment.file && fs.existsSync(path.join(this.store.dataDir, attachment.file))) continue
      if (this.downloading.has(attachment.id)) continue
      this.downloading.add(attachment.id)
      try {
        const url = `${baseUrl(ip, port)}/api/attachments/${encodeURIComponent(task.id)}/${encodeURIComponent(attachment.id)}`
        const res = await fetch(url, { signal: AbortSignal.timeout(120000) })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const rel = path.join('attachments', `${attachment.id}-${safeFileName(attachment.name)}`)
        const abs = path.join(this.store.dataDir, rel)
        const tmp = `${abs}.part`
        await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp))
        fs.renameSync(tmp, abs)

        const current = this.store.getTask(task.id)
        const target = current?.attachments.find((a) => a.id === attachment.id)
        if (current && target) {
          target.file = rel
          this.store.upsertTask(current)
          this.deps.emit()
        }
      } catch (err) {
        console.error('[attachments] download failed', attachment.name, (err as Error).message)
      } finally {
        this.downloading.delete(attachment.id)
      }
    }
  }

  private removeFiles(task: Task): void {
    for (const attachment of task.attachments) this.removeAttachmentFile(attachment)
  }
}