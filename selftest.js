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
  check('por defecto la confirmación dura 20 s como máximo', r.pending && r.pending.ttl <= 20000 && r.pending.ttl >= 5000, String(r.pending && r.pending.ttl));

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

async function audioControlTests() {
  console.log('\n[3] Etapa 3: volumen por app y dispositivo (puente simulado)');
  const ID1 = '{0.0.0.00000000}.{aaaaaaaa-0000-0000-0000-000000000001}';
  const ID2 = '{0.0.0.00000000}.{bbbbbbbb-0000-0000-0000-000000000002}';
  const ID3 = '{0.0.0.00000000}.{cccccccc-0000-0000-0000-000000000003}';
  const st = {
    devs: [
      { id: ID1, nombre: 'Altavoces (Realtek)', volumen: 40, silenciado: false, predeterminado: false, pico: 0 },
      { id: ID2, nombre: 'Auriculares (Realtek)', volumen: 60, silenciado: false, predeterminado: true, pico: 5 },
      { id: ID3, nombre: 'Monitor HDMI (NVIDIA)', volumen: 100, silenciado: false, predeterminado: false, pico: 0 },
    ],
    mics: [
      { id: '{0.0.1.00000000}.{aaaaaaaa-0000-0000-0000-0000000000a1}', nombre: 'Microphone Array (Realtek(R) Audio)', volumen: 100, silenciado: false, predeterminado: true, pico: 0 },
      { id: '{0.0.1.00000000}.{bbbbbbbb-0000-0000-0000-0000000000a2}', nombre: 'Micrófono (CORSAIR HS80 Wireless Gaming Receiver)', volumen: 80, silenciado: false, predeterminado: false, pico: 0 },
      { id: '{0.0.1.00000000}.{cccccccc-0000-0000-0000-0000000000a3}', nombre: 'Micrófono (USB Audio Device)', volumen: 70, silenciado: false, predeterminado: false, pico: 0 },
      { id: '{0.0.1.00000000}.{dddddddd-0000-0000-0000-0000000000a4}', nombre: 'Mezcla estéreo (Realtek(R) Audio)', volumen: 100, silenciado: false, predeterminado: false, pico: 0 },
    ],
    apps: [
      { nombre: 'Spotify', proceso: 'Spotify', pid: 10, volumen: 70, silenciada: false, estado: 1, pico: 30 },
      { nombre: 'chrome', proceso: 'chrome', pid: 11, volumen: 100, silenciada: false, estado: 1, pico: 10 },
      { nombre: 'chrome', proceso: 'chrome', pid: 12, volumen: 100, silenciada: false, estado: 0, pico: 0 },
      { nombre: 'msedge', proceso: 'msedge', pid: 13, volumen: 50, silenciada: false, estado: 0, pico: 0 },
      { nombre: 'Sonidos del sistema', proceso: '', pid: 0, volumen: 100, silenciada: false, estado: 0, pico: 0 },
    ],
  };
  const calls = [];
  let rechazar = false;
  const bridge = {
    request: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'audio.leer') return { json: JSON.stringify(args.direccion === 'entrada' ? { direccion: 'entrada', dispositivos: st.mics, apps: [] } : { direccion: 'salida', dispositivos: st.devs, apps: st.apps }) };
      if (cmd === 'audio.app') {
        if (rechazar) return { afectadas: 0 };
        let n = 0;
        for (const a of st.apps) if (args.pids.includes(a.pid)) {
          if (args.nivel >= 0) a.volumen = args.nivel;
          if (args.silencio >= 0) a.silenciada = args.silencio === 1;
          n++;
        }
        return { afectadas: n };
      }
      if (cmd === 'audio.dispositivo') {
        if (rechazar) throw new Error('Windows rechazó el cambio');
        const lista = st.mics.some((m) => m.id === args.id) ? st.mics : st.devs;
        for (const d of lista) d.predeterminado = d.id === args.id;
        return { ok: true };
      }
      if (cmd === 'audio.nivel_dispositivo') {
        if (rechazar) throw new Error('Windows rechazó el cambio');
        const dv = [...st.mics, ...st.devs].find((d) => d.id === args.id);
        if (!dv) throw new Error('Windows no encontró ese dispositivo.');
        if (args.nivel >= 0) dv.volumen = args.nivel;
        if (args.silencio >= 0) dv.silenciado = args.silencio === 1;
        return { ok: true };
      }
      throw new Error('comando inesperado ' + cmd);
    },
  };
  const reg = createRegistry({ ttlMs: 400 });
  const ctlT = require('./tools/audio-control')(reg, bridge);
  require('./tools/audio')(reg, bridge);
  const cambios = () => calls.filter((c) => c.cmd === 'audio.app' || c.cmd === 'audio.dispositivo').length;

  let r = await reg.invoke('audio_volumen_app', { app: 'spotify', accion: 'bajar' });
  check('baja Spotify 10 puntos y lo verifica', r.ok && r.verified && st.apps[0].volumen === 60 && /70% → 60%/.test(r.mensaje), r.text);
  r = await reg.invoke('audio_volumen_app', { app: 'Spotify', accion: 'establecer', porcentaje: 25 });
  check('establece Spotify al 25 %', r.ok && r.verified && st.apps[0].volumen === 25, r.text);
  r = await reg.invoke('audio_volumen_app', { app: 'spotify', accion: 'subir', paso: 90 });
  check('subir nunca pasa de 100', st.apps[0].volumen === 100, String(st.apps[0].volumen));
  r = await reg.invoke('audio_volumen_app', { app: 'google chrome', accion: 'establecer', porcentaje: 30 });
  check('"google chrome" llega a chrome y cambia todas sus sesiones', r.verified && st.apps[1].volumen === 30 && st.apps[2].volumen === 30, r.text);
  r = await reg.invoke('audio_volumen_app', { app: 'spotify', accion: 'silenciar' });
  check('silencia una app y lo verifica', r.verified && st.apps[0].silenciada === true && /silenciada/.test(r.mensaje), r.text);
  r = await reg.invoke('audio_volumen_app', { app: 'spotify', accion: 'activar_sonido' });
  check('le quita el silencio', r.verified && st.apps[0].silenciada === false, r.text);
  r = await reg.invoke('audio_volumen_app', { app: 'sistema', accion: 'establecer', porcentaje: 50 });
  check('los sonidos del sistema se alcanzan por su PID 0', r.verified && st.apps[4].volumen === 50, r.text);
  const c0 = cambios();
  r = await reg.invoke('audio_volumen_app', { app: 'e', accion: 'bajar' });
  check('nombre ambiguo (chrome y msedge) → AMBIGUO y no cambia nada', r.clarify && /AMBIGUO/.test(r.text) && cambios() === c0, r.text);
  r = await reg.invoke('audio_volumen_app', { app: 'photoshop', accion: 'bajar' });
  check('app que no existe → FALLÓ y lista las que sí hay', !r.ok && /Spotify/.test(r.text) && cambios() === c0, r.text);
  r = await reg.invoke('audio_volumen_app', { app: 'spotify', accion: 'establecer' });
  check('establecer sin porcentaje → FALLÓ', !r.ok && cambios() === c0, r.text);
  r = await reg.invoke('audio_volumen_app', { app: 'spotify', accion: 'establecer', porcentaje: 150 });
  check('porcentaje fuera de 0-100 → rechazado', !r.ok && cambios() === c0);
  r = await reg.invoke('audio_volumen_app', { app: 'spotify', accion: 'explotar' });
  check('acción no permitida → rechazada', !r.ok && cambios() === c0);
  rechazar = true;
  r = await reg.invoke('audio_volumen_app', { app: 'spotify', accion: 'bajar' });
  check('si Windows no toca ninguna sesión → FALLÓ', !r.ok, r.text);
  rechazar = false;

  // Cambio de dispositivo (directo, sin pedir confirmación)
  const c1 = cambios();
  r = await reg.invoke('audio_cambiar_dispositivo', { dispositivo: 'altavoces' });
  check('cambiar de dispositivo se hace directo (sin confirmación) y se verifica', r.ok && r.verified && !r.pending && st.devs[0].predeterminado && !st.devs[1].predeterminado && cambios() === c1 + 1, r.text);
  check('dice «Se ha cambiado a altavoces de la laptop.»', /^VERIFICADO: Se ha cambiado a altavoces de la laptop\./.test(r.text), r.text);
  r = await reg.invoke('audio_cambiar_dispositivo', { dispositivo: 'auriculares' });
  check('auriculares con cable → «Se ha cambiado a altavoces externos.»', r.verified && st.devs[1].predeterminado && /Se ha cambiado a altavoces externos\./.test(r.text), r.text);
  r = await reg.invoke('audio_cambiar_dispositivo', { dispositivo: 'parlantes' });
  check('alias "parlantes" → laptop', r.verified && st.devs[0].predeterminado && !st.devs[1].predeterminado, r.text);
  r = await reg.invoke('audio_cambiar_dispositivo', { dispositivo: 'altavoces' });
  check('si ya es el predeterminado → FALLÓ «Ya estás usando …» y no cambia nada', !r.ok && /Ya estás usando altavoces de la laptop/.test(r.text) && cambios() === c1 + 3, r.text);
  r = await reg.invoke('audio_cambiar_dispositivo', { dispositivo: 'realtek' });
  check('nombre ambiguo → AMBIGUO y no cambia nada', r.clarify && /AMBIGUO/.test(r.text) && cambios() === c1 + 3, r.text);
  r = await reg.invoke('audio_cambiar_dispositivo', { dispositivo: 'bluetooth' });
  check('dispositivo inexistente → FALLÓ con la lista', !r.ok && /Altavoces/.test(r.text), r.text);
  rechazar = true;
  r = await reg.invoke('audio_cambiar_dispositivo', { dispositivo: 'hdmi' });
  check('si Windows rechaza el cambio → FALLÓ y dice que no se cambió nada', !r.ok && /No se cambió nada/.test(r.text) && st.devs[0].predeterminado, r.text);
  rechazar = false;
  st.devs[2].id = 'x; calc.exe';
  r = await reg.invoke('audio_cambiar_dispositivo', { dispositivo: 'hdmi' });
  check('un identificador de dispositivo raro nunca llega a PowerShell', !r.ok, r.text);

  // Micrófonos (entrada): cambio directo y «qué tengo en uso»
  rechazar = false;
  const c3 = cambios();
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'laptop' });
  check('micrófono: si ya es el de la laptop → FALLÓ «Ya estás usando micrófono de la laptop»', !r.ok && /Ya estás usando micrófono de la laptop/.test(r.text) && cambios() === c3, r.text);
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'audífonos inalámbricos' });
  check('micrófono: a los audífonos se hace directo → «audífonos inalámbricos CORSAIR»', r.ok && r.verified && !r.pending && st.mics[1].predeterminado && !st.mics[0].predeterminado && /Se ha cambiado a audífonos inalámbricos CORSAIR\./.test(r.text), r.text);
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'externo' });
  check('micrófono: «externo» elige el USB (no la laptop, ni el Corsair, ni la mezcla) → «micrófono externo»', r.verified && st.mics[2].predeterminado && /Se ha cambiado a micrófono externo\./.test(r.text), r.text);
  st.mics[2].nombre = 'Micrófono (ETHOS 101)';
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'laptop' });
  check('micrófono: la laptop → «micrófono de la laptop»', r.verified && st.mics[0].predeterminado && /Se ha cambiado a micrófono de la laptop\./.test(r.text), r.text);
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'externo' });
  check('micrófono: externo con modelo → «micrófono externo ETHOS 101»', r.verified && st.mics[2].predeterminado && /Se ha cambiado a micrófono externo ETHOS 101\./.test(r.text), r.text);
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'mezcla estereo' });
  check('micrófono: la mezcla estéreo nunca se ofrece', !r.ok && !r.pending, r.text);
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'externo' });
  check('micrófono: si ya es el predeterminado → FALLÓ «Ya estás usando …»', !r.ok && /Ya estás usando micrófono externo ETHOS 101/.test(r.text), r.text);
  const idOriginal = st.mics[1].id; st.mics[1].id = 'x; calc.exe';
  const c3b = cambios();
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'corsair' });
  check('micrófono: un identificador raro nunca llega a PowerShell', !r.ok && cambios() === c3b, r.text);
  st.mics[1].id = idOriginal;
  st.mics[2].nombre = 'Micrófono (USB Audio Device)';
  st.devs[0].predeterminado = true; st.devs[1].predeterminado = false; st.devs[2].predeterminado = false;
  r = await reg.invoke('audio_en_uso', {});
  check('audio_en_uso: dice salida y entrada con nombres directos', r.ok && r.verified && /Salida en uso: altavoces de la laptop, volumen 40%/.test(r.mensaje) && /Entrada en uso: micrófono externo, volumen 70%/.test(r.mensaje) && /USB Audio Device/.test(r.text), r.text);
  r = await reg.invoke('audio_en_uso', { cual: 'entrada' });
  check('audio_en_uso: si solo preguntan por la entrada, solo contesta la entrada', r.ok && /Entrada en uso/.test(r.mensaje) && !/Salida/.test(r.mensaje), r.text);
  r = await reg.invoke('audio_en_uso', { cual: 'salida' });
  check('audio_en_uso: si solo preguntan por la salida, solo contesta la salida', r.ok && /Salida en uso/.test(r.mensaje) && !/Entrada/.test(r.mensaje), r.text);
  const nm = require('./tools/audio-nombres');
  check('nombres: audífonos Corsair → «audífonos inalámbricos CORSAIR» (salida y entrada)', nm.etiquetaSalida({ nombre: 'Altavoces (CORSAIR HS80 RGB WIRELESS Gaming Receiver)' }) === 'audífonos inalámbricos CORSAIR');
  check('nombres: modelo del micrófono externo', nm.modeloDe('Micrófono (ETHOS 101)') === 'ETHOS 101' && nm.modeloDe('Micrófono (USB Audio Device)') === '' && nm.modeloDe('Microphone (USB PnP Sound Device)') === '');

  // Nombres que Windows pone y no se reconocen: por descarte, y enseñándolos
  const anm = require('./tools/audio-nombres');
  anm.setDir(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'elix-alias-')));
  for (const m of st.mics) m.predeterminado = false;
  st.mics[2].predeterminado = true;
  st.mics[0].nombre = 'Conjunto de dispositivos (Chip Raro)';
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'laptop' });
  check('micrófono: si el interno tiene un nombre raro, se deduce por descarte (USB y Corsair ya conocidos)', r.verified && st.mics[0].predeterminado && /micrófono de la laptop/.test(r.text), r.text);
  st.mics[0].predeterminado = false; st.mics[2].predeterminado = true;
  st.mics[2].nombre = 'Microphone (Modelo X)';
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'laptop' });
  check('micrófono: con dos sin reconocer no adivina: lista los micrófonos y explica cómo enseñarle', !r.ok && !r.pending && /Chip Raro/.test(r.text) && /Modelo X/.test(r.text) && /es el de la laptop/.test(r.text), r.text);
  r = await reg.invoke('audio_asignar_microfono', { dispositivo: 'chip raro', rol: 'laptop' });
  check('audio_asignar_microfono: guarda la etiqueta y la verifica', r.ok && r.verified, r.text);
  r = await reg.invoke('audio_asignar_microfono', { dispositivo: 'modelo x', rol: 'externo' });
  check('audio_asignar_microfono: también el externo', r.ok && r.verified, r.text);
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'laptop' });
  check('después de enseñarle, «laptop» ya se encuentra y cambia', r.verified && st.mics[0].predeterminado, r.text);
  check('lo enseñado queda guardado en el archivo (uno por rol)', anm.leerAlias().length === 2);
  r = await reg.invoke('audio_asignar_microfono', { dispositivo: 'r', rol: 'laptop' });
  check('audio_asignar_microfono: nombre que coincide con varios → pregunta cuál, no guarda', !r.ok && !r.pending && anm.leerAlias().length === 2, r.text);
  r = await reg.invoke('audio_asignar_microfono', { dispositivo: 'corsair', rol: 'laptop' });
  await reg.invoke('audio_asignar_microfono', { dispositivo: 'chip raro', rol: 'laptop' });
  check('enseñar de nuevo un rol reemplaza al anterior (no se duplica)', anm.leerAlias().filter((x) => x.rol === 'laptop').length === 1);

  // Volumen y silencio del micrófono en uso, y volver al dispositivo de antes
  for (const m of st.mics) m.predeterminado = false;
  st.mics[0].predeterminado = true; st.mics[0].volumen = 80; st.mics[0].silenciado = false;
  const c4 = cambios();
  r = await reg.invoke('audio_microfono_volumen', { accion: 'bajar' });
  check('micrófono: baja el volumen 10 puntos y lo verifica', r.ok && r.verified && st.mics[0].volumen === 70 && /70%/.test(r.mensaje) && /antes 80%/.test(r.mensaje), r.text);
  r = await reg.invoke('audio_microfono_volumen', { accion: 'subir', paso: 50 });
  check('micrófono: subir nunca pasa de 100', r.verified && st.mics[0].volumen === 100, String(st.mics[0].volumen));
  r = await reg.invoke('audio_microfono_volumen', { accion: 'establecer', porcentaje: 35 });
  check('micrófono: lo deja en 35 %', r.verified && st.mics[0].volumen === 35, r.text);
  r = await reg.invoke('audio_microfono_volumen', { accion: 'silenciar' });
  check('micrófono: silenciar lo verifica y no toca el volumen', r.verified && st.mics[0].silenciado === true && st.mics[0].volumen === 35 && /silenciado/.test(r.mensaje), r.text);
  r = await reg.invoke('audio_microfono_volumen', { accion: 'activar_sonido' });
  check('micrófono: activar el sonido', r.verified && st.mics[0].silenciado === false && /activado otra vez/.test(r.mensaje), r.text);
  const cNiv = cambios();
  r = await reg.invoke('audio_microfono_volumen', { accion: 'establecer' });
  check('micrófono: establecer sin porcentaje → FALLÓ', !r.ok, r.text);
  r = await reg.invoke('audio_microfono_volumen', { accion: 'establecer', porcentaje: 150 });
  check('micrófono: porcentaje fuera de 0-100 → rechazado', !r.ok);
  r = await reg.invoke('audio_microfono_volumen', { accion: 'explotar' });
  check('micrófono: acción no permitida → rechazada', !r.ok);
  rechazar = true;
  r = await reg.invoke('audio_microfono_volumen', { accion: 'bajar' });
  check('micrófono: si Windows rechaza el cambio → FALLÓ', !r.ok && st.mics[0].volumen === 35, r.text);
  rechazar = false;
  const volAntes = st.mics[0].volumen, idUso = st.mics[0].id; st.mics[0].id = 'x; calc.exe';
  r = await reg.invoke('audio_microfono_volumen', { accion: 'bajar' });
  check('micrófono: un identificador raro nunca llega a PowerShell', !r.ok && st.mics[0].volumen === volAntes, r.text);
  st.mics[0].id = idUso;

  const regN = createRegistry(); require('./tools/audio-control')(regN, bridge);
  r = await regN.invoke('audio_volver_anterior', { cual: 'entrada' });
  check('volver al anterior: si no hay ninguno guardado lo dice y no cambia nada', !r.ok && /No tengo guardado/.test(r.text), r.text);
  r = await reg.invoke('audio_cambiar_microfono', { dispositivo: 'corsair' });
  check('(preparación) cambia al Corsair', r.verified && st.mics[1].predeterminado, r.text);
  r = await reg.invoke('audio_volver_anterior', { cual: 'entrada' });
  check('volver al anterior: el micrófono de antes (laptop), directo y verificado', r.ok && r.verified && st.mics[0].predeterminado && /Se ha vuelto a micrófono de la laptop\./.test(r.text), r.text);
  r = await reg.invoke('audio_volver_anterior', { cual: 'entrada' });
  check('volver al anterior otra vez te lleva de regreso (Corsair)', r.verified && st.mics[1].predeterminado && /audífonos inalámbricos CORSAIR/.test(r.text), r.text);
  const c5 = cambios();
  st.mics[0].activo = false;
  const copia = st.mics.splice(0, 1)[0]; // la laptop «desaparece» (desconectada)
  r = await reg.invoke('audio_volver_anterior', { cual: 'entrada' });
  check('volver al anterior: si ya no está conectado → FALLÓ y no cambia nada', !r.ok && /Ya no veo/.test(r.text) && cambios() === c5, r.text);
  st.mics.unshift(copia);
  r = await reg.invoke('audio_volver_anterior', { cual: 'salida' });
  check('volver al anterior (salida): regresa al dispositivo de antes', r.ok && r.verified && /Se ha vuelto a /.test(r.text), r.text);
  r = await reg.invoke('audio_volver_anterior', { cual: 'altavoz' });
  check('volver al anterior: valor no permitido → rechazado', !r.ok);

  // Silencio temporal del micrófono (el temporizador vive en el programa principal)
  const fsT = require('fs');
  const esperar = (ms) => new Promise((res) => setTimeout(res, ms));
  const avisos = []; ctlT.setAvisar((t) => avisos.push(t));
  for (const m of st.mics) m.predeterminado = false;
  st.mics[0].predeterminado = true; st.mics[0].silenciado = false; st.mics[0].volumen = 60;
  const fTemp = require('path').join(anm.dirDatos(), 'silencio-temporal.json');
  r = await reg.invoke('audio_microfono_volumen', { accion: 'silenciar', segundos: 1 });
  check('silencio temporal: silencia, dice la duración y arma el temporizador', r.ok && r.verified && st.mics[0].silenciado === true && /por 1 segundo/.test(r.mensaje) && /Se reactivará solo/.test(r.mensaje) && ctlT.hayTemporales(), r.text);
  check('silencio temporal: queda anotado en disco (por si Radex se cierra)', fsT.existsSync(fTemp));
  await esperar(1600);
  check('silencio temporal: pasado el tiempo se reactiva solo, avisa y borra la nota', st.mics[0].silenciado === false && !ctlT.hayTemporales() && avisos.length === 1 && /activado otra vez/.test(avisos[0]) && !fsT.existsSync(fTemp), JSON.stringify(avisos));
  avisos.length = 0;
  await reg.invoke('audio_microfono_volumen', { accion: 'silenciar', segundos: 1 });
  await reg.invoke('audio_microfono_volumen', { accion: 'activar_sonido' });
  await esperar(1500);
  check('silencio temporal: si lo activas antes, el temporizador se cancela (no avisa de nuevo)', st.mics[0].silenciado === false && avisos.length === 0 && !ctlT.hayTemporales(), JSON.stringify(avisos));
  await reg.invoke('audio_microfono_volumen', { accion: 'silenciar', segundos: 1 });
  await reg.invoke('audio_microfono_volumen', { accion: 'silenciar' });
  await esperar(1500);
  check('silencio temporal: si luego lo silencias sin tiempo, sigue silenciado (se anula el temporizador)', st.mics[0].silenciado === true && avisos.length === 0 && !ctlT.hayTemporales(), JSON.stringify(avisos));
  await reg.invoke('audio_microfono_volumen', { accion: 'activar_sonido' });
  r = await reg.invoke('audio_microfono_volumen', { accion: 'silenciar', segundos: 150 });
  check('duración 150 s → «2 minutos y 30 segundos»', /por 2 minutos y 30 segundos/.test(r.mensaje), r.mensaje);
  r = await reg.invoke('audio_microfono_volumen', { accion: 'silenciar', segundos: 3600 });
  check('duración 3600 s → «1 hora»', /por 1 hora \(/.test(r.mensaje), r.mensaje);
  r = await reg.invoke('audio_microfono_volumen', { accion: 'silenciar', segundos: 7500 });
  check('duración 7500 s → «2 horas y 5 minutos»', /por 2 horas y 5 minutos/.test(r.mensaje), r.mensaje);
  await ctlT.liberar();
  check('al cerrar Radex: se reactiva el micrófono y se borra la nota', st.mics[0].silenciado === false && !ctlT.hayTemporales() && !fsT.existsSync(fTemp));
  fsT.writeFileSync(fTemp, JSON.stringify({ v: 1, items: [{ id: st.mics[0].id, hasta: Date.now() - 5000, nombre: 'x' }] }));
  st.mics[0].silenciado = true; avisos.length = 0;
  await ctlT.recuperar();
  check('al abrir Radex: un silencio vencido que quedó pendiente se reactiva y avisa', st.mics[0].silenciado === false && avisos.length === 1, JSON.stringify(avisos));
  fsT.writeFileSync(fTemp, JSON.stringify({ v: 1, items: [{ id: st.mics[0].id, hasta: Date.now() + 60000, nombre: 'x' }] }));
  st.mics[0].silenciado = true;
  await ctlT.recuperar();
  check('al abrir Radex: si faltaba tiempo, se retoma el silencio con su temporizador', st.mics[0].silenciado === true && ctlT.hayTemporales());
  await ctlT.liberar();
  fsT.writeFileSync(fTemp, JSON.stringify({ v: 1, items: [{ id: 'x; calc.exe', hasta: 1, nombre: 'x' }] }));
  const antesN = st.mics[0].silenciado; await ctlT.recuperar();
  check('al abrir Radex: un identificador raro en la nota se ignora', st.mics[0].silenciado === antesN && !ctlT.hayTemporales());
  r = await reg.invoke('audio_microfono_volumen', { accion: 'silenciar', segundos: 0 });
  check('segundos = 0 → rechazado', !r.ok);
  r = await reg.invoke('audio_microfono_volumen', { accion: 'silenciar', segundos: 999999 });
  check('más de 12 horas → rechazado', !r.ok && !ctlT.hayTemporales());
  r = await reg.invoke('audio_microfono_volumen', { accion: 'bajar', segundos: 5 });
  check('segundos solo vale con silenciar (con bajar se ignora)', r.ok && !ctlT.hayTemporales());

  const srcCtl = fs.readFileSync(path.join(__dirname, 'native', 'audio-control.ps1'), 'utf8');
  const srcLect = fs.readFileSync(path.join(__dirname, 'native', 'audio.ps1'), 'utf8');
  check('ningún módulo declara clases COM con "new" (chocarían entre sí al cargarse los dos)', !/new\s+(MMDeviceEnumeratorCom|PolicyConfigClient)\s*\(/.test(srcLect + srcCtl) && !/class\s+(MMDeviceEnumeratorCom|PolicyConfigClient)/.test(srcLect + srcCtl));
  const blq = (srcCtl.match(/interface IAudioEndpointVolume[\s\S]*?\n    }/) || [''])[0];
  check('audio-control.ps1: IAudioEndpointVolume tiene los 13 métodos en orden (SetMasterVolumeLevelScalar es el 5.º y SetMute el 12.º)', (blq.match(/\[PreserveSig\]/g) || []).length === 13 && blq.split('[PreserveSig]')[5].includes('SetMasterVolumeLevelScalar') && blq.split('[PreserveSig]')[12].includes('SetMute'));
  check('audio-control.ps1 define audio.nivel_dispositivo con valores validados', /ELIX_H\['audio\.nivel_dispositivo'\]/.test(srcCtl) && /nivel < -1 \|\| nivel > 100/.test(srcCtl));
  check('audio-control.ps1 no ejecuta programas ni descarga nada', !/Start-Process|Invoke-Expression|iex |Invoke-WebRequest|DownloadString|cmd\.exe|powershell\.exe/i.test(srcCtl));
}

async function powershellTests() {
  console.log('\n[4] Puente PowerShell (worker persistente)');
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
  console.log('\n[5] Audio real de Windows (lectura; el control solo se compila, no cambia nada)');
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
    const cc0 = await br.request('audio.app', { pids: [999999], nivel: 50, silencio: -1 }, { module: 'audio-control' });
    check('el control funciona estando cargados los dos módulos a la vez (sin pid real no toca nada)', cc0.afectadas === 0, JSON.stringify(cc0));
    const t2 = Date.now();
    const cc = await br.request('audio.control_ok', {}, { module: 'audio-control', timeout: 30000 });
    check(`el módulo de control compila (${Date.now() - t2} ms)`, typeof cc.politica === 'string');
    check('Windows ofrece el cambio de dispositivo', cc.politica === 'ok', cc.politica);
    const sinNivel = await br.request('audio.nivel_dispositivo', { id: 'x', nivel: -1, silencio: -1 }, { module: 'audio-control' });
    check('audio.nivel_dispositivo compila y sin nivel ni silencio no toca nada', sinNivel.ok === true, JSON.stringify(sinNivel));
    const nada = await br.request('audio.app', { pids: [], nivel: -1, silencio: -1 }, { module: 'audio-control' });
    check('audio.app sin sesiones no toca nada', nada.afectadas === 0);
    console.log(`     ${m.dispositivos.length} micrófono(s)`);
  } catch (x) {
    check('el audio de Windows funciona', false, x.message);
  } finally { br.stop(); }
}

async function memoriaTests() {
  console.log('\n[M] Memoria permanente');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elix-mem-'));
  const reg = createRegistry({ ttlMs: 2000 });
  require('./tools/memoria')(reg).setDir(dir);
  let r = await reg.invoke('memoria_guardar', { tipo: 'proceso', titulo: 'Prueba', texto: 'paso 1, paso 2' });
  check('guarda y verifica', r.ok && r.verified, r.text);
  r = await reg.invoke('memoria_guardar', { titulo: 'Secreto', texto: 'mi contraseña es 1234' });
  check('rechaza contraseñas', !r.ok, r.text);
  r = await reg.invoke('memoria_consultar', { busqueda: 'prueba' });
  check('consulta lo guardado', /paso 1/.test(r.text), r.text);
  r = await reg.invoke('memoria_olvidar', { titulo: 'Prueba' });
  check('olvidar pide confirmación', !!r.pending, r.text);
  r = await reg.confirm(true);
  check('olvida y verifica', r.ok && r.verified, r.text);
}

(async () => {
  console.log('Radex — autodiagnóstico de herramientas (etapas 1 a 4)');
  await logicTests();
  await memoriaTests();
  await audioLogicTests();
  await audioControlTests();
  await powershellTests();
  await windowsAudioTests();
  console.log(`\nResultado: ${okN} correctas, ${failN} con problema.`);
  process.exit(failN ? 1 : 0);
})();
