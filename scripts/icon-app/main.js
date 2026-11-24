const { app, BrowserWindow } = require('electron')
const path = require('node:path')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    hasShadow: false,
    webPreferences: { offscreen: false }
  })
  win.loadFile(path.join(__dirname, 'icon.html'))
})