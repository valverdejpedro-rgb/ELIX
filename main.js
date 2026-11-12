const { app, BrowserWindow, Menu, shell, session, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const browser = require('./browser');
const { proxyFetch } = require('./netproxy');

// Se conserva la carpeta de datos de ELIX (claves, ajustes, notas, sesión de YouTube) al cambiar el nombre a Radex
app.setPath('userData', path.join(app.getPath('appData'), 'ELIX'));

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

// Llamadas a Groq / OpenRouter / Gemini desde aquí (sin límites de CORS del navegador)
ipcMain.handle('net:fetch', (e, req) => trusted(e) ? proxyFetch(req && typeof req === 'object' ? req : {}) : { status: 0, body: 'No permitido.' });

// ---------------- Acciones de PC (las usa window.jarvisNative) ----------------
// Solo hacen cosas concretas y seguras (abrir apps instaladas, carpetas, volumen, etc.).
// Nunca ejecutan texto libre como comando.
const nrm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const run = (exe, args = []) => new Promise((res, rej) => {
  const c = spawn(exe, args, { detached: true, stdio: 'ignore' });
  c.once('error', rej); c.once('spawn', () => { c.unref(); res(); });
});
const BUILTIN = {
  'calculadora': 'calc.exe', 'calculator': 'calc.exe', 'bloc de notas': 'notepad.exe', 'notas': 'notepad.exe', 'notepad': 'notepad.exe',
  'paint': 'mspaint.exe', 'explorador': 'explorer.exe', 'explorador de archivos': 'explorer.exe', 'archivos': 'explorer.exe',
  'administrador de tareas': 'taskmgr.exe', 'recortes': 'snippingtool.exe', 'herramienta de recortes': 'snippingtool.exe',
};
const URIS = { 'configuracion': 'ms-settings:', 'ajustes': 'ms-settings:', 'spotify': 'spotify:', 'whatsapp': 'whatsapp:', 'tienda': 'ms-windows-store:', 'microsoft store': 'ms-windows-store:' };
const ALIAS = { 'vscode': 'visual studio code', 'vs code': 'visual studio code', 'code': 'visual studio code', 'chrome': 'google chrome', 'edge': 'microsoft edge', 'google': 'google chrome' };
let lnkCache = { t: 0, list: [] };
function startMenuApps() {
  if (Date.now() - lnkCache.t < 5 * 60 * 1000) return lnkCache.list;
  const roots = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
                 path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
  const out = [];
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(f, depth + 1); }
      else if (/\.lnk$/i.test(e.name) && !/desinstal|uninstall/i.test(e.name)) out.push({ name: nrm(e.name.replace(/\.lnk$/i, '')), file: f });
    }
  };
  roots.forEach((r) => walk(r, 0));
  lnkCache = { t: Date.now(), list: out }; return out;
}
function findApp(q) {
  let best = null, bs = 0;
  for (const a of startMenuApps()) {
    const sc = a.name === q ? 3 : a.name.startsWith(q) ? 2 : a.name.includes(q) ? 1 : 0;
    if (sc > bs || (sc === bs && sc > 0 && best && a.name.length < best.name.length)) { best = a; bs = sc; }
  }
  return best;
}
const FOLDERS = { descargas: 'downloads', downloads: 'downloads', documentos: 'documents', documents: 'documents', escritorio: 'desktop', desktop: 'desktop',
  imagenes: 'pictures', fotos: 'pictures', pictures: 'pictures', musica: 'music', music: 'music', videos: 'videos', inicio: 'home', usuario: 'home' };
const KEYS = { subir: 175, bajar: 174, silenciar: 173, play_pausa: 179, siguiente: 176, anterior: 177 };
function sendKey(vk, times = 1) {
  const n = Math.max(1, Math.min(50, parseInt(times, 10) || 1)), k = parseInt(vk, 10);
  const script = `$w=New-Object -ComObject WScript.Shell; 1..${n} | ForEach-Object { $w.SendKeys([char]${k}) }`;
  return new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (err) => (err ? rej(err) : res())));
}
const NATIVE = {
  async abrir_aplicacion({ nombre }) {
    let q = nrm(nombre); if (!q) return 'Dime qué aplicación abrir.';
    q = ALIAS[q] || q;
    if (BUILTIN[q]) { await run(BUILTIN[q]); return `Abrí ${nombre}.`; }
    const a = findApp(q);
    if (a) { const err = await shell.openPath(a.file); return err ? 'No pude abrirla: ' + err : `Abrí ${nombre}.`; }
    if (URIS[q]) { await shell.openExternal(URIS[q]); return `Abrí ${nombre}.`; }
    return `No encontré una aplicación llamada "${nombre}" instalada en este PC.`;
  },
  async abrir_carpeta({ carpeta }) {
    const k = FOLDERS[nrm(carpeta)]; if (!k) return 'Carpetas disponibles: descargas, documentos, escritorio, imágenes, música, videos.';
    const err = await shell.openPath(app.getPath(k)); return err ? 'No pude abrirla: ' + err : `Abrí ${carpeta}.`;
  },
  async ajustar_volumen({ accion, pasos }) {
    if (!['subir', 'bajar', 'silenciar'].includes(accion)) return 'Acción no válida.';
    if (accion === 'silenciar') { await sendKey(KEYS.silenciar, 1); return 'Alterné el silencio del PC.'; }
    const n = Math.max(1, Math.min(25, parseInt(pasos, 10) || 5));
    await sendKey(KEYS[accion], n); return `Volumen del PC ${accion === 'subir' ? 'subido' : 'bajado'} (${n * 2}%).`;
  },
  async control_multimedia({ accion }) {
    if (!['play_pausa', 'siguiente', 'anterior'].includes(accion)) return 'Acción no válida.';
    await sendKey(KEYS[accion], 1); return { play_pausa: 'Pausé o reanudé la reproducción.', siguiente: 'Siguiente canción.', anterior: 'Canción anterior.' }[accion];
  },
  async info_del_sistema() {
    const c = os.cpus(), gb = (b) => (b / 1073741824).toFixed(1), up = os.uptime();
    return `Procesador: ${c[0].model.trim()} (${c.length} núcleos). RAM: ${gb(os.totalmem() - os.freemem())} GB en uso de ${gb(os.totalmem())} GB. Encendido hace ${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min. Sistema: ${os.version()}.`;
  },
  async controlar_ventana({ aplicacion, accion }) {
    const cmd = { maximizar: 3, minimizar: 6, restaurar: 9 }[accion];
    if (!cmd) return 'Acción no válida: usa maximizar, minimizar o restaurar.';
    let q = nrm(aplicacion); if (!q) return 'Dime de qué aplicación.';
    const BR = { chrome: 'chrome', google: 'chrome', 'google chrome': 'chrome', edge: 'edge', 'microsoft edge': 'edge', brave: 'brave' };
    if (BR[q]) {
      const r = await browser.run('ventana', { navegador: BR[q], accion });
      if (r !== 'NOABIERTO') return r;
      q = { chrome: 'chrome', edge: 'msedge', brave: 'brave' }[BR[q]]; // navegador abierto por el usuario, no por Radex
    }
    const script = [
      'Add-Type @"', 'using System; using System.Runtime.InteropServices;',
      'public class W { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }',
      '"@',
      '$n = $env:ELIX_WIN_NAME; $c = [int]$env:ELIX_WIN_CMD',
      '$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like "*$n*" -or $_.MainWindowTitle -like "*$n*") } | Select-Object -First 1',
      'if (-not $p) { Write-Output "NOENCONTRADO"; exit }',
      '[W]::ShowWindowAsync($p.MainWindowHandle, $c) | Out-Null',
      'if ($c -ne 6) { [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }',
      'Write-Output $p.ProcessName',
    ].join('\n');
    const out = await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000, env: { ...process.env, ELIX_WIN_NAME: q, ELIX_WIN_CMD: String(cmd) } },
      (err, so) => (err ? rej(err) : res(String(so).trim()))));
    if (!out || out === 'NOENCONTRADO') return `No encontré una ventana abierta de "${aplicacion}".`;
    return `${{ maximizar: 'Maximicé', minimizar: 'Minimicé', restaurar: 'Restauré' }[accion]} la ventana de ${aplicacion}.`;
  },
  async bloquear_pc() { await run('rundll32.exe', ['user32.dll,LockWorkStation']); return 'PC bloqueado.'; },
};
ipcMain.handle('native:run', async (e, name, input) => {
  if (!trusted(e)) return 'No permitido.';
  if (process.platform !== 'win32') return 'Esta acción solo funciona en Windows.';
  const fn = Object.prototype.hasOwnProperty.call(NATIVE, name) ? NATIVE[name] : null;
  if (!fn) return 'Acción de PC desconocida: ' + String(name);
  try { return await fn(input && typeof input === 'object' ? input : {}); }
  catch (err) { return 'No pude hacerlo: ' + String((err && err.message) || err).split('\n')[0].slice(0, 200); }
});

let lastStatus = { estado: 'inicio' };
const sendStatus = (s) => { lastStatus = s; try { win && win.webContents.send('update:status', s); } catch {} };
ipcMain.handle('app:info', (e) => trusted(e) ? { version: app.getVersion(), status: lastStatus } : null);
ipcMain.handle('app:check', (e) => {
  if (!trusted(e)) return;
  if (!app.isPackaged) return sendStatus({ estado: 'dev' });
  autoUpdater.checkForUpdates().catch(() => {});
});
ipcMain.handle('app:micprivacy', (e) => { if (trusted(e)) shell.openExternal('ms-settings:privacy-microphone'); });
ipcMain.handle('app:install', (e) => { if (trusted(e)) autoUpdater.quitAndInstall(true, true); });

let win;
async function createWindow() {
  const ok = await startServer();
  win = new BrowserWindow({
    width: 900, height: 780, backgroundColor: '#050b14', title: 'Radex',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  // YouTube rechaza los reproductores que se identifican como "Electron": se presenta como Chrome normal
  const ua = session.defaultSession.getUserAgent().replace(/\s(Electron|elix|Radex)\/\S+/gi, '');
  session.defaultSession.setUserAgent(ua);
  win.webContents.setUserAgent(ua);
  // El reproductor incrustado exige Referer (sin él da "Error 153"); se lo garantizamos siempre
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'] },
    (details, cb) => {
      const h = details.requestHeaders;
      if (!h['Referer'] || !/^https?:/i.test(h['Referer'])) h['Referer'] = `http://localhost:${PORT}/`;
      cb({ requestHeaders: h });
    });
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
  autoUpdater.on('error', (e) => { console.error('Updater:', e && e.message); sendStatus({ estado: 'error', detalle: String((e && e.message) || e).split('\n')[0].slice(0, 220) }); });
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
