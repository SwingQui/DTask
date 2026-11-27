import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const DIR_A = '/tmp/dtask-manual-a'
const DIR_B = '/tmp/dtask-manual-b'

function launch(name, httpPort, discoveryPort, dataDir) {
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.mkdirSync(dataDir, { recursive: true })
  return electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      TASKPUSH_ALLOW_MULTI: '1',
      TASKPUSH_DATA_DIR: dataDir,
      TASKPUSH_HTTP_PORT: String(httpPort),
      TASKPUSH_DISCOVERY_PORT: String(discoveryPort),
      TASKPUSH_DEVICE_NAME: name
    }
  })
}

async function stateOf(page) {
  return page.evaluate(() => window.api.getState())
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

let a
let b

try {
  a = await launch('Manual-A', 47861, 47851, DIR_A)
  b = await launch('Manual-B', 47862, 47852, DIR_B)
  const pa = await a.firstWindow()
  const pb = await b.firstWindow()
  await pa.waitForSelector('.app')
  await pb.waitForSelector('.app')

  const before = await stateOf(pa)
  assert.equal(before.devices.length, 0, 'multicast should be isolated')
  console.log('[manual] discovery isolated as expected')

  await pa.evaluate(() => window.api.addPeer('127.0.0.1:47862'))
  await waitFor(async () => {
    const state = await stateOf(pa)
    return state.devices.some((d) => d.online && d.port === 47862) ? state : null
  }, 8000, 'manual peer online')
  console.log('[manual] peer added by IP')

  await pa.fill('.desc-input', '手动 IP 模式下也能双向同步吗？')
  await pa.click('button:has-text("存为草稿")')
  await pa.waitForSelector('.draft-card')
  await pa.dragAndDrop('.draft-card', '.device.is-online')

  const incoming = await waitFor(async () => {
    const state = await stateOf(pb)
    return state.tasks.length === 1 ? state.tasks[0] : null
  }, 8000, 'task delivered over manual peer')
  console.log('[manual] task delivered:', incoming.id)

  const learned = await waitFor(async () => {
    const state = await stateOf(pb)
    const peer = state.devices.find((d) => d.id === incoming.senderId)
    return peer && peer.online ? peer : null
  }, 8000, 'receiver learned sender')
  console.log('[manual] receiver learned sender at', learned.ip + ':' + learned.port)

  await pb.selectOption('.task-card .status-select', 'resolved')
  await waitFor(async () => {
    const state = await stateOf(pa)
    const task = state.tasks.find((t) => t.id === incoming.id)
    return task && task.status === 'resolved' ? task : null
  }, 8000, 'status pushed back over manual peer')
  console.log('[manual] status pushed back')

  await pa.screenshot({ path: path.join(root, '.artifacts', 'manual-a.png') })
  await pb.screenshot({ path: path.join(root, '.artifacts', 'manual-b.png') })
  console.log('[manual] ALL CHECKS PASSED')
} finally {
  if (a) await a.close().catch(() => {})
  if (b) await b.close().catch(() => {})
}