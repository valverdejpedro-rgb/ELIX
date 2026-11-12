'use strict';
// Autodiagnóstico del módulo de herramientas (etapa 1).
// Uso, en la carpeta del proyecto, en Windows:   node selftest.js
// No necesita Electron ni instalar nada. Si algo falla, copia la salida completa y envíamela.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRegistry } = require('./tools/registry');
const { createBridge } = require('./tools/psbridge');

let okN = 0, failN = 0;
const check = (name, cond, extra) => {
  if (cond) { okN++; console.log('  ✔ ' + name); }
  else { failN++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function logicTests() {
  console.log('\n[1] Registro: validación, confirmación, verificación y log');
  const logFile = path.join(os.tmpdir(), 'elix-selftest-' + Date.now() + '.jsonl');
  const reg = createRegistry({ logFile, ttlMs: 300 });
  let ran = 0;
  reg.register({
    name: 'tool_a', risk: 'safe', description: 'a',
    schema: { properties: { n: { type: 'integer', minimum: 0, maximum: 100 }, modo: { type: 'string', enum: ['subir', 'bajar'] }, texto: { type: 'string', maxLength: 10 }, token: { type: 'string' } }, required: ['n'] },
    run: async (a) => { ran++; return { ok: true, verified: a.modo !== 'bajar', mensaje: 'n=' + a.n }; },
  });
  reg.register({
    name: 'tool_confirm', risk: 'confirm', description: 'c',
    schema: { properties: {}, required: [] },
    plan: async () => ({ resolved: { x: 1 }, resumen: 'Voy a hacer X' }),
    run: async (_a, r) => { ran++; return { ok: true, verified: true, mensaje: 'hecho x=' + r.x }; },
  });
  reg.register({
    name: 'tool_confirm2', risk: 'confirm', description: 'c2', schema: { properties: {}, required: [] },
    plan: async () => ({ resolved: { y: 2 }, resumen: 'Voy a hacer Y' }),
    run: async (_a, r) => { ran++; return { ok: true, verified: true, mensaje: 'hecho y=' + r.y }; },
  });
  reg.register({
    name: 'tool_amb', risk: 'confirm', description: 'amb', schema: { properties: {}, required: [] },
    plan: async () => ({ clarify: { motivo: 'Hay dos coincidencias.', opciones: ['A', 'B'] } }),
    run: async () => { ran++; return { ok: true, verified: true, mensaje: 'no debería ejecutarse' }; },
  });
  reg.register({ name: 'tool_boom', risk: 'safe', description: 'b', run: async () => { throw new Error('explotó'); } });
  reg.register({ name: 'tool_fail', risk: 'safe', description: 'f', run: async () => ({ ok: false, mensaje: 'no pude' }) });

  let r = await reg.invoke('tool_a', { n: '20' });
  check('convierte "20" en número y ejecuta', r.ok && r.mensaje === 'n=20' && r.text.startsWith('VERIFICADO'));
  r = await reg.invoke('tool_a', { n: 20, modo: 'bajar' });
  check('sin verificación explícita → "HECHO PERO SIN VERIFICAR"', r.ok && !r.verified && r.text.startsWith('HECHO PERO SIN VERIFICAR'));
  r = await reg.invoke('tool_a', { n: 150 });
  check('rechaza valor fuera de rango', !r.ok && r.text.startsWith('FALLÓ'));
  r = await reg.invoke('tool_a', {});
  check('rechaza parámetro obligatorio ausente', !r.ok);
  const before = ran;
  r = await reg.invoke('tool_a', { n: 5, extra: 'x' });
  check('rechaza parámetros no declarados', !r.ok && ran === before);
  r = await reg.invoke('tool_a', { n: 5, modo: 'SUBIR' });
  check('acepta enum sin importar mayúsculas', r.ok);
  r = await reg.invoke('tool_a', { n: 5, texto: 'x'.repeat(50) });
  check('rechaza texto demasiado largo', !r.ok);
  r = await reg.invoke('tool_a', { n: 5, texto: 'hola\u0000mundo' });
  check('rechaza caracteres de control', !r.ok);
  r = await reg.invoke('no_existe', {});
  check('herramienta fuera de la lista blanca → rechazada', !r.ok && /no autorizada/i.test(r.text));
  r = await reg.invoke('constructor', {});
  check('nombres especiales (constructor) no pasan', !r.ok);
  r = await reg.invoke('tool_boom', {});
  check('si la herramienta lanza error → FALLÓ', !r.ok && /explotó/.test(r.text));
  r = await reg.invoke('tool_fail', {});
  check('ok:false → FALLÓ con el motivo', !r.ok && /no pude/.test(r.text));

  const ran0 = ran;
  r = await reg.invoke('tool_confirm', {});
  check('acción de riesgo NO se ejecuta y queda pendiente', ran === ran0 && !!r.pending && /PENDIENTE/.test(r.text));
  r = await reg.confirm(true);
  check('al confirmar se ejecuta con lo resuelto en plan', ran === ran0 + 1 && r.ok && r.verified && /x=1/.test(r.mensaje));
  r = await reg.confirm(true);
  check('una confirmación no se puede reutilizar', !r.ok && r.none);
  await reg.invoke('tool_confirm', {});
  r = await reg.confirm(false);
  check('rechazar cancela sin ejecutar', r.cancelled && ran === ran0 + 1);
  await reg.invoke('tool_confirm', {});
  await sleep(450);
  r = await reg.confirm(true);
  check('una confirmación vencida no se ejecuta', r.expired && ran === ran0 + 1);
  check('la confirmación vencida dice qué era y que no se hizo nada', /venció/.test(r.mensaje) && /Voy a hacer X/.test(r.mensaje) && r.resumen === 'Voy a hacer X', r.mensaje);
  r = await reg.confirm(true);
  check('tras vencer, no queda nada pendiente', !r.ok && r.none);
  await reg.invoke('tool_confirm', {});
  await sleep(450);
  r = await reg.confirm(false);
  check('un "no" tardío cancela sin ejecutar', r.cancelled && ran === ran0 + 1);
  await reg.confirm(false); // limpia cualquier pendiente
  const r2 = await reg.invoke('tool_amb', {});
  check('orden ambigua: no ejecuta ni deja nada pendiente', r2.clarify && /AMBIGUO/.test(r2.text) && !reg.hasPending() && ran === ran0 + 1);
  const ran1 = ran;
  await reg.invoke('tool_confirm', {});
  await reg.invoke('tool_confirm2', {});
  r = await reg.confirm(true);
  check('una petición nueva reemplaza a la pendiente anterior', ran === ran1 + 1 && /y=2/.test(r.mensaje), r.mensaje);

  const regDef = createRegistry();
  regDef.register({ name: 'tool_d', risk: 'confirm', description: 'd', plan: async () => ({ resolved: {}, resumen: 'D' }), run: async () => ({ ok: true, verified: true, mensaje: 'ok' }) });
  r = await regDef.invoke('tool_d', {});
  check('por defecto la confirmación dura 10 s como máximo', r.pending && r.pending.ttl <= 10000 && r.pending.ttl >= 5000, String(r.pending && r.pending.ttl));

  const cat = reg.catalog();
  check('el catálogo no expone funciones ni límites internos', cat.every((t) => !('run' in t) && !('plan' in t)) && !JSON.stringify(cat).includes('maxLength'));
  check('el catálogo avisa de la confirmación', /confirmación/.test(cat.find((t) => t.name === 'tool_confirm').description));

  await reg.invoke('tool_a', { n: 7, token: 'SECRETO-123' }).catch(() => {});
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  check('se escribe el registro de acciones', log.split('\n').filter(Boolean).length >= 5);
  check('el registro no guarda claves ni tokens', !log.includes('SECRETO-123'));
  try { fs.unlinkSync(logFile); } catch {}
}

async function audioLogicTests() {
  console.log('\n[2] Herramienta audio_estado (puente simulado, solo lectura)');
  const reg = createRegistry();
  let llamadas = [];
  const datos = {
    direccion: 'salida',
    dispositivos: [
      { id: 'a', nombre: 'Altavoces (Realtek)', volumen: 45, silenciado: false, predeterminado: true, pico: 12 },
      { id: 'b', nombre: 'Auriculares USB', volumen: 80, silenciado: true, predeterminado: false, pico: 0 },
    ],
    apps: [
      { nombre: 'Spotify', proceso: 'Spotify', pid: 10, volumen: 70, silenciada: false, estado: 1, pico: 30 },
      { nombre: 'chrome', proceso: 'chrome', pid: 11, volumen: 100, silenciada: false, estado: 0, pico: 0 },
    ],
  };
  const fake = { request: async (cmd, args, opts) => { llamadas.push({ cmd, args, opts }); return { json: JSON.stringify(datos) }; } };
  require('./tools/audio')(reg, fake);
  let r = await reg.invoke('audio_estado', {});
  check('audio_estado responde VERIFICADO', r.ok && r.verified && r.text.startsWith('VERIFICADO'), r.text);
  check('nombra el dispositivo y su volumen', /Altavoces \(Realtek\), volumen 45%/.test(r.mensaje), r.mensaje);
  check('dice qué app está sonando', /Sonando ahora: Spotify \(70%\)/.test(r.mensaje), r.mensaje);
  check('avisa del dispositivo silenciado', /Auriculares USB \(volumen 80%, SILENCIADO\)/.test(r.mensaje), r.mensaje);
  check('pide el comando fijo audio.leer del módulo audio', llamadas[0].cmd === 'audio.leer' && llamadas[0].opts.module === 'audio' && llamadas[0].args.direccion === 'salida');
  r = await reg.invoke('audio_estado', { direccion: 'micro' });
  check('rechaza una dirección no válida', !r.ok);
  r = await reg.invoke('audio_estado', { direccion: 'entrada' });
  check('micrófono: se pide "entrada"', llamadas[llamadas.length - 1].args.direccion === 'entrada');
  datos.apps = []; datos.dispositivos[0].pico = 0;
  r = await reg.invoke('audio_estado', {});
  check('sin apps sonando lo dice', /Ninguna aplicación está sonando/.test(r.mensaje), r.mensaje);
  const fail = { request: async () => { throw new Error('boom'); } };
  const reg2 = createRegistry(); require('./tools/audio')(reg2, fail);
  r = await reg2.invoke('audio_estado', {});
  check('si Windows falla → FALLÓ con el motivo', !r.ok && /boom/.test(r.text), r.text);
  check('es de solo lectura (risk safe, sin parámetros que cambien nada)', reg.catalog().every((t) => !/subir|bajar|silenciar|establecer/i.test(JSON.stringify(t.inputSchema))));
  const src = fs.readFileSync(path.join(__dirname, 'native', 'audio.ps1'), 'utf8');
  check('audio.ps1 no llama a ningún método que cambie el audio', !/\.(SetMute|SetMasterVolume\w*|SetChannelVolume\w*|SetDefaultEndpoint)\(/.test(src));
}

async function powershellTests() {
  console.log('\n[3] Puente PowerShell (worker persistente)');
  const exe = process.env.ELIX_SELFTEST_PS || undefined; // solo para pruebas en otros sistemas
  if (!exe && process.platform !== 'win32') { console.log('  (omitido: esto solo se prueba en Windows)'); return; }
  const br = createBridge({ exe });
  try {
    let t0 = Date.now();
    let p = await br.request('ping');
    const first = Date.now() - t0;
    check(`PowerShell responde (primer arranque ${first} ms)`, p && p.pong === true);
    console.log(`     PowerShell ${p.psVersion}, modo ${p.mode}, ${p.bits64 ? '64' : '32'} bits, Windows/OS ${p.os}, ${p.culture}`);
    check('modo FullLanguage (necesario para compilar C#)', p.mode === 'FullLanguage', 'modo ' + p.mode);
    t0 = Date.now(); await br.request('ping');
    const second = Date.now() - t0;
    check(`segunda llamada rápida (${second} ms)`, second < 1500, second + ' ms');
    const txt = 'áéíóú ñ ¿qué? 日本 ✓';
    const e = await br.request('echo', { text: txt });
    check('acentos y caracteres raros ida y vuelta', e.text === txt, JSON.stringify(e));
    const c = await br.request('selfcheck', {}, { timeout: 30000 });
    check(`compilación C# con Add-Type (${c.ms} ms)`, c.addType === true, c.error);
    let err = '';
    try { await br.request('no_existe'); } catch (x) { err = x.message; }
    check('comando desconocido → error claro', /desconocido/.test(err), err);
    err = '';
    try { await br.request('ping; calc.exe'); } catch (x) { err = x.message; }
    check('nombre de comando con símbolos → rechazado antes de llegar a PowerShell', /no válido/i.test(err), err);
    err = '';
    try { await br.load('../worker'); } catch (x) { err = x.message; }
    check('no se pueden cargar módulos fuera de native/', /no válido/i.test(err), err);
    err = '';
    try { await br.request('sleep', { ms: 5000 }, { timeout: 600 }); } catch (x) { err = x.message; }
    check('tiempo agotado → se detecta', /tiempo agotado/.test(err), err);
    p = await br.request('ping');
    check('después del tiempo agotado el worker se reinicia solo', p.pong === true && br.status().starts >= 2);
  } catch (x) {
    check('el puente PowerShell funciona', false, x.message);
  } finally { br.stop(); }
}

async function windowsAudioTests() {
  console.log('\n[4] Audio real de Windows (solo lectura)');
  if (process.platform !== 'win32') { console.log('  (omitido: esto solo se prueba en Windows)'); return; }
  const br = createBridge();
  try {
    const t0 = Date.now();
    const r = await br.request('audio.leer', { direccion: 'salida' }, { module: 'audio', timeout: 30000 });
    const d = JSON.parse(r.json);
    check(`compila y lee el audio (${Date.now() - t0} ms)`, Array.isArray(d.dispositivos));
    console.log(`     ${d.dispositivos.length} dispositivo(s) de salida, ${d.apps.length} app(s) con sesión de audio`);
    for (const x of d.dispositivos) console.log(`     - ${x.predeterminado ? '[predeterminado] ' : ''}${x.nombre} · volumen ${x.volumen}% ${x.silenciado ? '(silenciado) ' : ''}· pico ${x.pico}`);
    for (const a of d.apps) console.log(`     · ${a.nombre} (${a.proceso}) · volumen ${a.volumen}% · pico ${a.pico}`);
    check('hay al menos un dispositivo de salida', d.dispositivos.length > 0);
    check('el predeterminado trae nombre y volumen 0-100', d.dispositivos.some((x) => x.predeterminado && x.nombre && x.volumen >= 0 && x.volumen <= 100), JSON.stringify(d.dispositivos));
    const t1 = Date.now(); await br.request('audio.leer', { direccion: 'salida' }, { module: 'audio' });
    check(`segunda lectura rápida (${Date.now() - t1} ms)`, Date.now() - t1 < 2500);
    const m = JSON.parse((await br.request('audio.leer', { direccion: 'entrada' }, { module: 'audio' })).json);
    check('también lee los micrófonos', m.direccion === 'entrada' && Array.isArray(m.dispositivos));
    console.log(`     ${m.dispositivos.length} micrófono(s)`);
  } catch (x) {
    check('el audio de Windows funciona', false, x.message);
  } finally { br.stop(); }
}

(async () => {
  console.log('Radex — autodiagnóstico de herramientas (etapas 1 y 2)');
  await logicTests();
  await audioLogicTests();
  await powershellTests();
  await windowsAudioTests();
  console.log(`\nResultado: ${okN} correctas, ${failN} con problema.`);
  process.exit(failN ? 1 : 0);
})();
