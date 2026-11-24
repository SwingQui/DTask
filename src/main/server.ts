import http from 'node:http'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PeerIdentity, Task } from '../shared/types'

const MAX_BODY = 30 * 1024 * 1024
const START_PORT = Number(process.env.TASKPUSH_HTTP_PORT) || 47821

export interface AttachmentSource {
  absPath: string
  name: string
  mime: string
}

export interface ServerDeps {
  identity: () => PeerIdentity
  receiveTask: (task: Task, ip: string) => Promise<void>
  syncTasks: (tasks: Task[], fromDeviceId: string, ip: string, port: number) => Promise<Task[]>
  resolveAttachment: (taskId: string, attId: string) => AttachmentSource | null
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  })
  res.end(payload)
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<Task>
  return (
    typeof task.id === 'string' &&
    task.id.length > 0 &&
    task.id.length < 100 &&
    typeof task.senderId === 'string' &&
    (task.mode === 'simple' || task.mode === 'standard') &&
    typeof task.description === 'string' &&
    Array.isArray(task.attachments)
  )
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    title: typeof task.title === 'string' ? task.title.slice(0, 500) : '',
    description: task.description.slice(0, 200000),
    status: ['active', 'resolved', 'voided'].includes(task.status) ? task.status : 'active',
    direction: task.direction === 'out' ? 'out' : 'in',
    unread: Boolean(task.unread),
    senderPort: Number(task.senderPort) || undefined,
    deleted: Boolean(task.deleted),
    revision: Number.isFinite(task.revision) ? task.revision : 1,
    createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now(),
    updatedAt: Number.isFinite(task.updatedAt) ? task.updatedAt : Date.now(),
    attachments: task.attachments
      .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string')
      .slice(0, 50)
      .map((a) => ({
        id: a.id.slice(0, 100),
        name: a.name.slice(0, 255),
        size: Number(a.size) || 0,
        mime: typeof a.mime === 'string' ? a.mime.slice(0, 120) : 'application/octet-stream',
        file: ''
      }))
  }
}

export function startServer(deps: ServerDeps): Promise<{ port: number; close: () => void }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = url.pathname

    try {
      if (req.method === 'GET' && pathname === '/api/identity') {
        sendJson(res, 200, deps.identity())
        return
      }
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/tasks') {
        const body = (await readJson(req)) as { task?: unknown }
        if (!isTask(body?.task)) {
          sendJson(res, 400, { error: 'invalid task' })
          return
        }
        const ip = req.socket.remoteAddress?.replace('::ffff:', '') || ''
        await deps.receiveTask(normalizeTask(body.task), ip)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/sync') {
        const body = (await readJson(req)) as { deviceId?: string; port?: unknown; tasks?: unknown }
        if (typeof body?.deviceId !== 'string' || !Array.isArray(body.tasks)) {
          sendJson(res, 400, { error: 'invalid sync payload' })
          return
        }
        const tasks = body.tasks.filter(isTask).slice(0, 5000).map(normalizeTask)
        const ip = req.socket.remoteAddress?.replace('::ffff:', '') || ''
        const port = Number(body.port) || 47821
        const reply = await deps.syncTasks(tasks, body.deviceId, ip, port)
        sendJson(res, 200, { tasks: reply })
        return
      }

      if (req.method === 'GET' && pathname.startsWith('/api/attachments/')) {
        const parts = pathname.split('/').filter(Boolean)
        const taskId = decodeURIComponent(parts[2] || '')
        const attId = decodeURIComponent(parts[3] || '')
        const source = deps.resolveAttachment(taskId, attId)
        if (!source || !fs.existsSync(source.absPath)) {
          sendJson(res, 404, { error: 'attachment not found' })
          return
        }
        const stat = fs.statSync(source.absPath)
        const encoded = encodeURIComponent(source.name)
        res.writeHead(200, {
          'Content-Type': source.mime,
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
          'Cache-Control': 'no-store'
        })
        fs.createReadStream(source.absPath).pipe(res)
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'invalid json' || message === 'payload too large') {
        if (!res.headersSent) {
          sendJson(res, message === 'invalid json' ? 400 : 413, { error: message })
        }
        return
      }
      console.error('[server] request failed', err)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
    }
  })

  return new Promise((resolve, reject) => {
    let port = START_PORT
    let attempts = 0

    const tryListen = (): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempts < 20) {
          attempts += 1
          port += 1
          setTimeout(tryListen, 30)
          return
        }
        reject(err)
      })
      server.listen(port, '0.0.0.0', () => {
        resolve({
          port,
          close: () => server.close()
        })
      })
    }

    tryListen()
  })
}