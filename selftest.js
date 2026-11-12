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
  await reg.confirm(false); // limpia cualquier pendiente
  const r2 = await reg.invoke('tool_amb', {});
  check('orden ambigua: no ejecuta ni deja nada pendiente', r2.clarify && /AMBIGUO/.test(r2.text) && !reg.hasPending() && ran === ran0 + 1);
  const ran1 = ran;
  await reg.invoke('tool_confirm', {});
  await reg.invoke('tool_confirm2', {});
  r = await reg.confirm(true);
  check('una petición nueva reemplaza a la pendiente anterior', ran === ran1 + 1 && /y=2/.test(r.mensaje), r.mensaje);

  const cat = reg.catalog();
  check('el catálogo no expone funciones ni límites internos', cat.every((t) => !('run' in t) && !('plan' in t)) && !JSON.stringify(cat).includes('maxLength'));
  check('el catálogo avisa de la confirmación', /confirmación/.test(cat.find((t) => t.name === 'tool_confirm').description));

  await reg.invoke('tool_a', { n: 7, token: 'SECRETO-123' }).catch(() => {});
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  check('se escribe el registro de acciones', log.split('\n').filter(Boolean).length >= 5);
  check('el registro no guarda claves ni tokens', !log.includes('SECRETO-123'));
  try { fs.unlinkSync(logFile); } catch {}
}

async function powershellTests() {
  console.log('\n[2] Puente PowerShell (worker persistente)');
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

(async () => {
  console.log('Radex — autodiagnóstico de herramientas (etapa 1)');
  await logicTests();
  await powershellTests();
  console.log(`\nResultado: ${okN} correctas, ${failN} con problema.`);
  process.exit(failN ? 1 : 0);
})();
