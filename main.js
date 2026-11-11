const { app, BrowserWindow, Menu, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Servimos app/ en localhost con puerto fijo: así localStorage (tus claves y
// ajustes) se conserva entre actualizaciones y YouTube/micrófono funcionan.
const PORT = 38417;
const ROOT = path.join(__dirname, 'app');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('No encontrado'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', () => resolve(false));
    server.listen(PORT, '127.0.0.1', () => resolve(true));
  });
}

let win;
async function createWindow() {
  const ok = await startServer();
  win = new BrowserWindow({
    width: 900, height: 780, backgroundColor: '#050b14', title: 'ELIX',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  // Permitir micrófono
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) =>
    cb(['media', 'audioCapture', 'microphone'].includes(perm)));
  // Enlaces externos al navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(ok ? `http://localhost:${PORT}/` : 'file://' + path.join(ROOT, 'index.html'));
}

// ---- Actualizaciones automáticas ----
function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // se instala sola al cerrar ELIX
  autoUpdater.on('update-downloaded', () => {
    // Reinicia e instala en cuanto la ventana quede libre
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 3000);
  });
  autoUpdater.on('error', (e) => console.error('Updater:', e && e.message));
  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), 60 * 60 * 1000); // cada hora
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { createWindow(); setupUpdater(); });
  app.on('window-all-closed', () => app.quit());
}
