import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const artifacts = path.join(root, '.artifacts')
fs.mkdirSync(artifacts, { recursive: true })

function launch(name, port, dataDir) {
  fs.rmSync(dataDir, { recursive: true, force: true })
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
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

const a = await launch('Mac-A', 47831, '/tmp/taskdrop-e2e-a')
const b = await launch('Win-B', 47832, '/tmp/taskdrop-e2e-b')

try {
  const pa = await a.firstWindow()
  const pb = await b.firstWindow()
  await pa.waitForSelector('.app')
  await pb.waitForSelector('.app')

  const seen = await waitFor(async () => {
    const s = await stateOf(pa)
    return s.devices.length > 0 && s.devices.every((d) => d.online) ? s : null
  }, 20000, 'peer discovery')

  console.log('A sees devices:', seen.devices.map((d) => `${d.name} ${d.ip}:${d.port} online=${d.online}`).join(', '))
  console.log('A self:', seen.self)
  await pa.screenshot({ path: path.join(artifacts, 'smoke-a.png') })
  await pb.screenshot({ path: path.join(artifacts, 'smoke-b.png') })
  console.log('screenshots saved')
} finally {
  await a.close()
  await b.close()
}