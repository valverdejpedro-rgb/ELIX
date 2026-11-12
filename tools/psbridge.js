'use strict';
// Puente con un PowerShell persistente: un solo proceso, comandos fijos y datos en JSON.
// El código que se carga sale SIEMPRE de archivos propios de la carpeta native/ (nunca del modelo
// ni de la página), y los parámetros viajan como datos: nunca se concatenan dentro de un script.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const NATIVE_DIR = path.join(__dirname, '..', 'native');
const WIN_PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PREFIX = '@@ELIX@@';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// Arranque mínimo: lee de stdin la primera línea (el worker en base64) y lo ejecuta.
// Así el script no depende de rutas dentro del .asar, ni de la política de ejecución de scripts.
const BOOT = Buffer.from(
  "$ErrorActionPreference='Stop'; $l=[Console]::In.ReadLine(); & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($l))))",
  'utf16le').toString('base64');

// exe: solo para pruebas (selftest); en la app siempre es el PowerShell de Windows.
function createBridge({ exe, timeoutMs = 15000, nativeDir = NATIVE_DIR } = {}) {
  let proc = null, buf = '', nextId = 1, spawns = 0, lastError = '';
  let loaded = new Set();
  const pending = new Map();
  let chain = Promise.resolve();

  function failAll(msg) {
    for (const w of pending.values()) { clearTimeout(w.timer); w.reject(new Error(msg)); }
    pending.clear();
  }

  function spawnWorker() {
    if (!exe && process.platform !== 'win32') throw new Error('Esta función solo existe en Windows.');
    const core = fs.readFileSync(path.join(nativeDir, 'worker.ps1'), 'utf8');
    const p = spawn(exe || WIN_PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', BOOT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { err = (err + d).slice(-500); });
    p.stdin.on('error', () => {});
    p.stdout.on('data', (chunk) => {
      if (proc !== p) return;
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        const k = line.indexOf(PREFIX);
        if (k < 0) continue;
        let m;
        try { m = JSON.parse(Buffer.from(line.slice(k + PREFIX.length), 'base64').toString('utf8')); } catch { continue; }
        const w = pending.get(m.id);
        if (!w) continue;
        pending.delete(m.id); clearTimeout(w.timer);
        if (m.ok) w.resolve(m.data); else w.reject(new Error(String(m.error || 'error desconocido')));
      }
    });
    const dead = (why) => {
      if (proc !== p) return;
      proc = null; loaded = new Set(); lastError = why;
      failAll(why);
    };
    p.on('error', (e) => dead('No pude iniciar PowerShell: ' + e.message));
    p.on('exit', () => dead('PowerShell se cerró' + (err.trim() ? ': ' + err.trim().replace(/\s+/g, ' ').slice(0, 200) : '.')));
    proc = p; buf = ''; spawns++;
    p.stdin.write(b64(core) + '\n');
  }

  function killWorker(why) {
    const p = proc; proc = null; loaded = new Set();
    failAll(why);
    if (p) { try { p.stdin.end(); } catch {} try { p.kill(); } catch {} }
  }

  function rpc(msg, timeout) {
    return new Promise((resolve, reject) => {
      const fresh = !proc;
      if (fresh) { try { spawnWorker(); } catch (e) { return reject(e); } }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('tiempo agotado'));
        killWorker('PowerShell reiniciado tras un tiempo agotado.'); // el worker es de un solo hilo: si se atasca, se reinicia
      }, timeout + (fresh ? 10000 : 0));
      pending.set(id, { resolve, reject, timer });
      try { proc.stdin.write(b64(JSON.stringify({ ...msg, id })) + '\n'); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }

  // Carga un módulo propio de native/<nombre>.ps1 (una sola vez por proceso)
  async function load(name) {
    if (!/^[a-z0-9_-]{1,30}$/.test(String(name))) throw new Error('Módulo no válido.');
    if (proc && loaded.has(name)) return;
    const code = fs.readFileSync(path.join(nativeDir, name + '.ps1'), 'utf8');
    await rpc({ t: 'load', code }, 30000);
    loaded.add(name);
  }

  // Ejecuta un comando fijo del worker. Las peticiones se atienden de una en una.
  function request(cmd, args, { timeout = timeoutMs, module } = {}) {
    if (!/^[a-z][a-z0-9_.]{0,40}$/i.test(String(cmd))) return Promise.reject(new Error('Comando no válido.'));
    const job = chain.then(async () => {
      if (module) await load(module);
      return rpc({ t: 'req', cmd: String(cmd), args: args && typeof args === 'object' ? args : {} }, timeout);
    });
    chain = job.catch(() => {});
    return job;
  }

  const stop = () => killWorker('PowerShell detenido.');
  const status = () => ({ running: !!proc, pid: proc ? proc.pid : null, starts: spawns, lastError, loaded: [...loaded] });
  return { request, load, stop, status };
}

module.exports = { createBridge };
