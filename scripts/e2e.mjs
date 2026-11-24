import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const artifacts = path.join(root, '.artifacts')
fs.mkdirSync(artifacts, { recursive: true })

const DIR_A = '/tmp/taskdrop-e2e-a'
const DIR_B = '/tmp/taskdrop-e2e-b'

function launch(name, port, dataDir, fresh) {
  if (fresh) {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  fs.mkdirSync(dataDir, { recursive: true })
  return electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      TASKPUSH_ALLOW_MULTI: '1',
      TASKPUSH_DATA_DIR: dataDir,
      TASKPUSH_HTTP_PORT: String(port),
      TASKPUSH_DEVICE_NAME: name,
      TASKPUSH_DISCOVERY_PORT: '47820'
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

function log(...args) {
  console.log('[e2e]', ...args)
}

let a
let b
let pa
let pb

try {
  a = await launch('Mac-A', 47831, DIR_A, true)
  b = await launch('Win-B', 47832, DIR_B, true)
  pa = await a.firstWindow()
  pb = await b.firstWindow()
  await pa.waitForSelector('.app')
  await pb.waitForSelector('.app')

  await waitFor(async () => {
    const sa = await stateOf(pa)
    const sb = await stateOf(pb)
    return sa.devices.some((d) => d.online) && sb.devices.some((d) => d.online)
  }, 20000, 'bidirectional discovery')
  log('discovery ok')

  // 1. create a draft through the UI
  await pa.fill('.desc-input', '帮我看一下预发环境的登录接口 500，怀疑是 token 过期逻辑')
  await pa.click('button:has-text("存为草稿")')
  await pa.waitForSelector('.draft-card')
  const draftState = await stateOf(pa)
  assert.equal(draftState.tasks.filter((t) => t.status === 'draft').length, 1)
  log('draft created')

  // 2. drag the draft onto the peer device
  await pa.dragAndDrop('.draft-card', '.device.is-online')

  let received = false
  try {
    await waitFor(async () => {
      const sb = await stateOf(pb)
      return sb.tasks.length === 1 ? sb : null
    }, 4000, 'task after drag')
    received = true
  } catch {
    log('native drag did not fire, falling back to synthetic drag events')
    await pa.evaluate(() => {
      const card = document.querySelector('.draft-card')
      const target = document.querySelector('.device.is-online')
      if (!card || !target) throw new Error('drag elements missing')
      const dt = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    })
    await waitFor(async () => {
      const sb = await stateOf(pb)
      return sb.tasks.length === 1 ? sb : null
    }, 6000, 'task after synthetic drag')
    received = true
  }

  assert.ok(received)
  const sb1 = await stateOf(pb)
  const incoming = sb1.tasks[0]
  assert.equal(incoming.status, 'active')
  assert.equal(incoming.direction, 'in')
  assert.equal(incoming.senderName, 'Mac-A')
  assert.equal(incoming.unread, true)
  assert.match(incoming.description, /登录接口 500/)
  log('task delivered:', incoming.id, incoming.title || incoming.description.slice(0, 12))

  await pa.screenshot({ path: path.join(artifacts, 'flow-a-sent.png') })
  await pb.screenshot({ path: path.join(artifacts, 'flow-b-received.png') })

  // 3. rename peer alias on A
  await pa.locator('.device.is-online .device-edit-btn').first().click({ force: true })
  await pa.fill('.device-edit input', '前端-小李')
  await pa.press('.device-edit input', 'Enter')
  const aliasState = await waitFor(async () => {
    const s = await stateOf(pa)
    return s.devices.some((d) => d.alias === '前端-小李') ? s : null
  }, 3000, 'alias saved')
  log('alias saved:', aliasState.devices.find((d) => d.alias)?.alias)

  // 4. change status on B, expect it to sync back to A
  await pb.selectOption('.task-card .status-select', 'resolved')
  const syncedBack = await waitFor(async () => {
    const sa = await stateOf(pa)
    const task = sa.tasks.find((t) => t.id === incoming.id)
    return task && task.status === 'resolved' ? task : null
  }, 8000, 'status synced back')
  log('status synced back:', syncedBack?.status)

  // 5. attachment round trip
  const attachFile = path.join(artifacts, '示例日志.txt')
  fs.writeFileSync(attachFile, 'hello attachment from Mac-A\n第二行中文\n', 'utf8')
  const sentWithAttachment = await pa.evaluate(async (filePath) => {
    const added = await window.api.addAttachmentPaths([filePath])
    const task = await window.api.saveTask({
      mode: 'standard',
      title: '附件：预发日志片段',
      description: '日志在附件里，帮忙看下 13:40 之后的那几次请求。',
      attachments: added
    })
    const state = await window.api.getState()
    const device = state.devices.find((d) => d.online)
    await window.api.sendTask(task.id, device.id)
    return task.id
  }, attachFile)

  const receivedAttachment = await waitFor(async () => {
    const sb = await stateOf(pb)
    const task = sb.tasks.find((t) => t.id === sentWithAttachment)
    if (!task) return null
    const att = task.attachments[0]
    if (!att || !att.file) return null
    const abs = path.join(DIR_B, att.file)
    return fs.existsSync(abs) ? task : null
  }, 15000, 'attachment downloaded')
  const att = receivedAttachment.attachments[0]
  const content = fs.readFileSync(path.join(DIR_B, att.file), 'utf8')
  assert.match(content, /hello attachment/)
  log('attachment ok:', att.name, att.size, 'bytes')

  // 6. offline change + reconnect reconciliation
  await b.close()
  b = null
  await waitFor(async () => {
    const sa = await stateOf(pa)
    return sa.devices.every((d) => !d.online) ? sa : null
  }, 25000, 'peer offline')
  log('peer offline')

  await pa.evaluate((id) => window.api.setStatus(id, 'voided'), incoming.id)
  const voidedLocal = await waitFor(async () => {
    const sa = await stateOf(pa)
    const task = sa.tasks.find((t) => t.id === incoming.id)
    return task && task.status === 'voided' ? task : null
  }, 3000, 'local void')
  log('local status changed while peer offline:', voidedLocal.status)

  b = await launch('Win-B', 47832, DIR_B, false)
  pb = await b.firstWindow()
  await pb.waitForSelector('.app')

  await waitFor(async () => {
    const sb = await stateOf(pb)
    const task = sb.tasks.find((t) => t.id === incoming.id)
    return task && task.status === 'voided' ? task : null
  }, 30000, 'reconnect reconciliation')
  log('reconnect reconciliation ok')

  // 7. final screenshots
  await pa.screenshot({ path: path.join(artifacts, 'final-a.png') })
  await pb.screenshot({ path: path.join(artifacts, 'final-b.png') })

  const finalA = await stateOf(pa)
  const finalB = await stateOf(pb)
  log('A tasks:', finalA.tasks.map((t) => `${t.status}/${t.direction}/${t.title || '(simple)'}`))
  log('B tasks:', finalB.tasks.map((t) => `${t.status}/${t.direction}/${t.title || '(simple)'}`))
  log('ALL CHECKS PASSED')
} finally {
  if (a) await a.close().catch(() => {})
  if (b) await b.close().catch(() => {})
}