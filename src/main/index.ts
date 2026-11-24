import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Store } from './store'
import { Discovery } from './discovery'
import type { PeerSeen } from './discovery'
import { TaskService } from './tasks'
import { startServer } from './server'
import type { AppState, Attachment, Device, SelfInfo, Task, TaskInput, TaskStatus } from '../shared/types'

const ONLINE_TTL = 12000
const dataDir = process.env.TASKPUSH_DATA_DIR
  ? path.resolve(process.env.TASKPUSH_DATA_DIR)
  : path.join(app.getPath('appData'), 'TaskDrop')

app.setPath('userData', dataDir)
app.setName('TaskDrop')
nativeTheme.themeSource = 'dark'
if (process.platform === 'win32') app.setAppUserModelId('com.taskdrop.app')

if (!process.env.TASKPUSH_ALLOW_MULTI) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  }
}

let win: BrowserWindow | null = null
let httpPort = 0
let store: Store
let tasks: TaskService
let discovery: Discovery
let serverClose: (() => void) | null = null

const livePeers = new Map<string, PeerSeen>()
const syncedPeers = new Set<string>()

function selfInfo(): SelfInfo {
  return {
    id: store.config.deviceId,
    name: store.config.deviceName,
    port: httpPort,
    platform: process.platform
  }
}

function buildState(): AppState {
  const now = Date.now()
  const devices: Device[] = store.peers
    .map((peer) => {
      const live = livePeers.get(peer.id)
      return {
        id: peer.id,
        name: live?.name || peer.name,
        alias: peer.alias,
        platform: live?.platform || peer.platform,
        ip: live?.ip || peer.ip,
        port: live?.port || peer.port,
        online: Boolean(live && now - live.lastSeen < ONLINE_TTL),
        manual: peer.manual,
        lastSeen: live?.lastSeen || 0
      }
    })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      return (a.alias || a.name).localeCompare(b.alias || b.name, 'zh-Hans-CN')
    })

  return {
    self: selfInfo(),
    devices,
    tasks: tasks.listTasks(),
    dataDir
  }
}

function emitState(): void {
  const state = buildState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('state', state)
  }
  const unread = state.tasks.filter((task) => task.unread && task.direction === 'in').length
  try {
    app.setBadgeCount(unread)
  } catch {
    /* unsupported platform */
  }
}

function notifyIncoming(task: Task): void {
  if (!Notification.isSupported()) return
  const body = task.title || task.description.slice(0, 80) || '收到一个新任务'
  const notification = new Notification({
    title: `${task.senderName} 发来任务`,
    body,
    silent: false
  })
  notification.on('click', () => {
    if (!win) return
    win.show()
    win.focus()
  })
  notification.show()
}

function parseAddress(raw: string): { ip: string; port: number } {
  const input = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const ipv6 = input.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (ipv6) return { ip: ipv6[1], port: Number(ipv6[2]) || 47821 }
  const ipv4 = input.match(/^([^:]+)(?::(\d+))?$/)
  if (!ipv4) throw new Error('地址格式不对，例如 192.168.1.8 或 192.168.1.8:47821')
  return { ip: ipv4[1], port: Number(ipv4[2]) || 47821 }
}

async function probePeer(ip: string, port: number): Promise<PeerSeen> {
  const url = `http://${ip.includes(':') ? `[${ip}]` : ip}:${port}/api/identity`
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`对方没有响应（HTTP ${res.status}）`)
  const identity = (await res.json()) as { deviceId?: string; name?: string; platform?: string; port?: number }
  if (!identity.deviceId) throw new Error('对方不是 TaskDrop 设备')
  return {
    deviceId: identity.deviceId,
    name: identity.name || '未知设备',
    platform: identity.platform || '',
    port: identity.port || port,
    ip,
    lastSeen: Date.now()
  }
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => buildState())

  ipcMain.handle('self:setName', (_event, name: string) => {
    store.setDeviceName(name)
    discovery.announce()
    emitState()
    return buildState().self
  })

  ipcMain.handle('peer:setAlias', (_event, deviceId: string, alias: string) => {
    store.setAlias(deviceId, alias)
    emitState()
  })

  ipcMain.handle('peer:add', async (_event, address: string) => {
    const { ip, port } = parseAddress(address)
    const seen = await probePeer(ip, port)
    store.upsertPeer({ ...seen, id: seen.deviceId, manual: true })
    livePeers.set(seen.deviceId, seen)
    emitState()
    void tasks.syncWithPeer(seen.deviceId).catch((err) => console.error('[sync] manual peer failed', err.message))
    return buildState().devices.find((d) => d.id === seen.deviceId) || null
  })

  ipcMain.handle('peer:remove', (_event, deviceId: string) => {
    store.removePeer(deviceId)
    livePeers.delete(deviceId)
    emitState()
  })

  ipcMain.handle('attachments:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择附件',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return tasks.addAttachmentFiles(result.filePaths)
  })

  ipcMain.handle('attachments:addPaths', (_event, paths: string[]) => {
    return tasks.addAttachmentFiles(paths)
  })

  ipcMain.handle('attachments:discard', (_event, attachment: Attachment) => {
    tasks.removeAttachmentFile(attachment)
  })

  ipcMain.handle('attachments:open', async (_event, taskId: string, attachmentId: string) => {
    const source = tasks.resolveAttachment(taskId, attachmentId)
    if (!source) throw new Error('附件还没下载好')
    const error = await shell.openPath(source.absPath)
    if (error) throw new Error(error)
  })

  ipcMain.handle('task:save', (_event, input: TaskInput, taskId?: string) => {
    return tasks.createOrUpdate(input, taskId)
  })

  ipcMain.handle('task:send', (_event, taskId: string, peerId: string) => {
    return tasks.sendTask(taskId, peerId)
  })

  ipcMain.handle('task:status', (_event, taskId: string, status: TaskStatus) => {
    return tasks.setStatus(taskId, status)
  })

  ipcMain.handle('task:read', (_event, taskId: string) => {
    tasks.markRead(taskId)
  })

  ipcMain.handle('task:delete', (_event, taskId: string) => {
    tasks.deleteTask(taskId)
  })

  ipcMain.handle('app:revealData', async () => {
    await shell.openPath(dataDir)
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#1b1b1b',
    title: 'TaskDrop',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win?.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('did-finish-load', () => emitState())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

async function bootstrap(): Promise<void> {
  fs.mkdirSync(dataDir, { recursive: true })
  store = new Store(dataDir)

  tasks = new TaskService({
    store,
    self: selfInfo,
    findPeer: (deviceId) => store.peers.find((p) => p.id === deviceId),
    isOnline: (deviceId) => {
      const live = livePeers.get(deviceId)
      return Boolean(live && Date.now() - live.lastSeen < ONLINE_TTL)
    },
    emit: emitState
  })

  const learnPeer = (seen: PeerSeen): void => {
    if (seen.deviceId === store.config.deviceId) return
    const previous = livePeers.get(seen.deviceId)
    const wasOnline = Boolean(previous && Date.now() - previous.lastSeen < ONLINE_TTL)
    const known = store.peers.find((peer) => peer.id === seen.deviceId)
    const name = seen.name && seen.name !== '未知设备' ? seen.name : known?.name || '未知设备'
    const platform = seen.platform || known?.platform || ''
    livePeers.set(seen.deviceId, { ...seen, name, platform })
    store.upsertPeer({ id: seen.deviceId, name, platform, ip: seen.ip, port: seen.port })
    emitState()

    if (!wasOnline) syncedPeers.delete(seen.deviceId)
    if (!syncedPeers.has(seen.deviceId)) {
      syncedPeers.add(seen.deviceId)
      setTimeout(() => {
        void tasks.syncWithPeer(seen.deviceId).catch((err) => {
          console.error('[sync] initial sync failed', err.message)
          syncedPeers.delete(seen.deviceId)
        })
      }, 400)
    }
  }

  const server = await startServer({
    identity: () => ({
      deviceId: store.config.deviceId,
      name: store.config.deviceName,
      platform: process.platform,
      port: httpPort
    }),
    receiveTask: async (task, ip) => {
      const known = store.peers.find((peer) => peer.id === task.senderId)
      learnPeer({
        deviceId: task.senderId,
        name: task.senderName || known?.name || '未知设备',
        platform: known?.platform || '',
        port: task.senderPort || known?.port || 47821,
        ip,
        lastSeen: Date.now()
      })
      const existed = Boolean(store.getTask(task.id))
      await tasks.receiveTask(task, ip)
      if (!existed) notifyIncoming(task)
    },
    syncTasks: async (incoming, fromDeviceId, ip, port) => {
      const name = incoming.find((task) => task.senderId === fromDeviceId)?.senderName || ''
      learnPeer({
        deviceId: fromDeviceId,
        name,
        platform: '',
        port,
        ip,
        lastSeen: Date.now()
      })
      return tasks.syncIncoming(incoming, fromDeviceId, ip)
    },
    resolveAttachment: (taskId, attId) => tasks.resolveAttachment(taskId, attId)
  })
  httpPort = server.port
  serverClose = server.close

  discovery = new Discovery(() => ({
    deviceId: store.config.deviceId,
    name: store.config.deviceName,
    platform: process.platform,
    port: httpPort
  }))
  discovery.on('peer', learnPeer)

  try {
    await discovery.start()
  } catch (err) {
    console.error('[discovery] failed to start, manual IP still available', err)
  }

  registerIpc()
  createWindow()

  setInterval(() => {
    const now = Date.now()
    for (const [deviceId, seen] of livePeers) {
      if (now - seen.lastSeen > ONLINE_TTL * 2) {
        livePeers.delete(deviceId)
        syncedPeers.delete(deviceId)
      }
    }
    emitState()
  }, 3000)
}

if (process.env.TASKPUSH_ALLOW_MULTI || app.hasSingleInstanceLock()) {
  app.whenReady().then(bootstrap).catch((err) => {
    console.error('[app] bootstrap failed', err)
    dialog.showErrorBox('TaskDrop 启动失败', String(err))
    app.quit()
  })
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  store?.saveNow()
  discovery?.stop()
  serverClose?.()
})