import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
fs.mkdirSync(path.join(root, 'build'), { recursive: true })

const app = await electron.launch({
  args: ['scripts/icon-app'],
  cwd: root
})

try {
  const page = await app.firstWindow()
  await page.waitForSelector('svg')
  await page.setViewportSize({ width: 1024, height: 1024 })
  await page.waitForTimeout(400)
  await page.screenshot({
    path: path.join(root, 'build', 'icon.png'),
    omitBackground: true
  })
  console.log('icon written to build/icon.png')
} finally {
  await app.close()
}