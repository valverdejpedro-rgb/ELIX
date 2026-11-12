const { app, BrowserWindow, Menu, shell, session, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const fs = require('fs');
const path = require('path');
const browser = require('./browser');

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

// Solo acepta llamadas de la propia ventana de ELIX
const trusted = (e) => {
  const u = (e.senderFrame && e.senderFrame.url) || '';
  return u.startsWith(`http://localhost:${PORT}/`) || u.startsWith('file://');
};
ipcMain.handle('browser:run', (e, accion, args) => {
  if (!trusted(e)) return 'No permitido.';
  return browser.run(String(accion), args && typeof args === 'object' ? args : {});
});

let lastStatus = { estado: 'inicio' };
const sendStatus = (s) => { lastStatus = s; try { win && win.webContents.send('update:status', s); } catch {} };
ipcMain.handle('app:info', (e) => trusted(e) ? { version: app.getVersion(), status: lastStatus } : null);
ipcMain.handle('app:check', (e) => {
  if (!trusted(e)) return;
  if (!app.isPackaged) return sendStatus({ estado: 'dev' });
  autoUpdater.checkForUpdates().catch(() => {});
});
ipcMain.handle('app:install', (e) => { if (trusted(e)) autoUpdater.quitAndInstall(true, true); });

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
const startedAt = Date.now();
function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // si no se reinicia antes, se instala al cerrar ELIX
  autoUpdater.on('checking-for-update', () => sendStatus({ estado: 'buscando' }));
  autoUpdater.on('update-available', (i) => sendStatus({ estado: 'descargando', version: i.version, pct: 0 }));
  autoUpdater.on('download-progress', (p) => sendStatus({ estado: 'descargando', pct: Math.round(p.percent) }));
  autoUpdater.on('update-not-available', () => sendStatus({ estado: 'al-dia' }));
  autoUpdater.on('update-downloaded', (i) => {
    sendStatus({ estado: 'listo', version: i.version });
    // Al abrir ELIX se reinicia solo; si ya lo estás usando (videos, etc.) no te interrumpe:
    // queda lista y se instala al cerrar, o pulsando la versión en pantalla.
    if (Date.now() - startedAt < 2 * 60 * 1000) setTimeout(() => autoUpdater.quitAndInstall(true, true), 2500);
  });
  autoUpdater.on('error', (e) => { console.error('Updater:', e && e.message); sendStatus({ estado: 'error' }); });
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000); // cada hora
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { createWindow(); setupUpdater(); });
  app.on('window-all-closed', () => app.quit());
}
