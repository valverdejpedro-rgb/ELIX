'use strict';
// Etapa 3: cambia el audio. Volumen/silencio de UNA aplicación (seguro: se verifica y es fácil de revertir)
// y dispositivo de salida predeterminado (pide confirmación por voz).
// Siempre se resuelve primero qué app o dispositivo es (plan); si hay duda, no se hace nada y se pregunta.
// Después de actuar se vuelve a leer Windows para comprobar que quedó así (VERIFICADO).
const { leerAudio } = require('./audio');
const fs = require('fs');
const path = require('path');
const { clasificarEntradas, ETIQUETA_ENTRADA, ROLES_ENTRADA, etiquetaMic, etiquetaSalida, leerAlias, guardarAlias, dirDatos } = require('./audio-nombres');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ALIAS_APP = { 'google chrome': 'chrome', 'microsoft edge': 'msedge', edge: 'msedge', sistema: 'sonidos del sistema', sonidos: 'sonidos del sistema' };
const ALIAS_DEV = { parlantes: 'altavoces', bocinas: 'altavoces', speakers: 'altavoces', audifonos: 'auriculares', headphones: 'auriculares', cascos: 'auriculares' };
// Tres destinos habituales, reconocidos por lo que el usuario pide y por cómo Windows nombra el dispositivo:
//  - inalambrico: audífonos inalámbricos, Bluetooth o Corsair; - cable: auriculares/audífonos con cable (jack);
//  - laptop: los parlantes/altavoces de la laptop. Se revisan en ese orden (“audífonos inalámbricos” gana a “audífonos”).
const CATEGORIAS = [
  { id: 'inalambrico', pide: /inalambric|wireless|bluetooth|corsair|airpods|buds|\bbt\b/, incluye: /corsair|wireless|bluetooth|hands.?free|airpods|buds|inalambric|\bbt\b/, excluye: null, nombre: 'los audífonos inalámbricos' },
  { id: 'cable', pide: /auricular|audifono|casco|headphone|headset/, incluye: /auricular|headphone|audifono|headset/, excluye: /corsair|wireless|bluetooth|hands.?free|airpods|buds|inalambric|\bbt\b/, nombre: 'los auriculares con cable' },
  { id: 'laptop', pide: /laptop|portatil|computadora|compu|\bpc\b|altavoz|altavoces|parlante|bocina|speaker/, incluye: /altavo(?:z|ces)|speaker|parlante|bocina/, excluye: /corsair|wireless|bluetooth|hands.?free|hdmi|nvidia|displayport|monitor|digital|spdif|usb|airpods|buds/, nombre: 'los parlantes de la laptop' },
];
const SECUNDARIOS = /chat|comunicaci|voz|voice|mic|llamada/; // endpoints de “chat” de un mismo dispositivo: se prefieren los demás
function porCategoria(devs, texto) {
  const q = norm(texto);
  const cat = CATEGORIAS.find((c) => c.pide.test(q));
  if (!cat) return null;
  let m = devs.filter((x) => { const n = norm(x.nombre); return cat.incluye.test(n) && !(cat.excluye && cat.excluye.test(n)); });
  if (m.length > 1) { const p = m.filter((x) => !SECUNDARIOS.test(norm(x.nombre))); if (p.length) m = p; }
  return { cat, match: m };
}
const ID_RE = /^\{[0-9a-f.]+\}\.\{[0-9a-f-]+\}$/i; // forma de los identificadores de dispositivo de Windows

module.exports = function registerAudioControl(registry, bridge) {
  // Dispositivo que se dejó en el último cambio hecho aquí (para «vuelve al de antes»); solo mientras Radex siga abierto
  const anterior = { salida: null, entrada: null };
  let tempCtl = null; // se rellena más abajo; lo usa tools/index.js (reactivar al abrir/cerrar, avisos)
  registry.register({
    name: 'audio_volumen_app',
    risk: 'safe',
    description: 'Cambia el volumen o el silencio de UNA aplicación de Windows concreta (Spotify, Chrome, Discord, el navegador…), sin tocar el volumen general. Úsala cuando nombren una aplicación: "baja Spotify", "silencia Chrome", "pon Discord al 30". Si piden el volumen general del PC usa ajustar_volumen. Si no está claro qué aplicación es, no hace nada y lo dice.',
    schema: {
      properties: {
        app: { type: 'string', maxLength: 60, description: 'Nombre de la aplicación (por ejemplo spotify, chrome, discord)' },
        accion: { type: 'string', enum: ['establecer', 'subir', 'bajar', 'silenciar', 'activar_sonido'], description: 'establecer necesita porcentaje; subir y bajar usan paso (10 por defecto)' },
        porcentaje: { type: 'integer', minimum: 0, maximum: 100, description: 'Volumen de 0 a 100 (solo con establecer)' },
        paso: { type: 'integer', minimum: 1, maximum: 100, description: 'Cuánto subir o bajar (por defecto 10)' },
      },
      required: ['app', 'accion'],
    },
    async plan(a) {
      let d;
      try { d = await leerAudio(bridge, 'salida'); } catch (e) { return { fail: 'No pude leer el audio de Windows: ' + e.message }; }
      const apps = d.apps || [];
      if (!apps.length) return { fail: 'Ninguna aplicación tiene sesión de audio abierta ahora mismo.' };
      let needle = norm(a.app);
      needle = ALIAS_APP[needle] || needle.replace(/^google /, '');
      if (!needle) return { fail: 'Dime qué aplicación.' };
      const lista = [...new Set(apps.map((x) => x.nombre))].join(', ');
      const match = apps.filter((x) => norm(x.nombre).includes(needle) || norm(x.proceso).includes(needle));
      if (!match.length) return { fail: `No encuentro ninguna aplicación llamada «${a.app}» con audio. Ahora tienen sesión de audio: ${lista}.` };
      const grupos = new Map();
      for (const x of match) {
        const k = norm(x.proceso || x.nombre);
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(x);
      }
      if (grupos.size > 1) return { clarify: { motivo: `«${a.app}» coincide con varias aplicaciones.`, opciones: [...grupos.values()].map((g) => g[0].nombre) } };
      const ses = [...grupos.values()][0];
      const actual = Math.max(...ses.map((x) => (x.volumen == null ? 0 : x.volumen)));
      let objetivo = null, silencio = -1;
      switch (a.accion) {
        case 'establecer':
          if (a.porcentaje == null) return { fail: 'Falta el porcentaje de volumen (0 a 100).' };
          objetivo = a.porcentaje; break;
        case 'subir': objetivo = Math.min(100, actual + (a.paso || 10)); break;
        case 'bajar': objetivo = Math.max(0, actual - (a.paso || 10)); break;
        case 'silenciar': silencio = 1; break;
        case 'activar_sonido': silencio = 0; break;
        default: return { fail: 'Acción no válida.' };
      }
      return { resolved: { pids: [...new Set(ses.map((x) => x.pid))], nombre: ses[0].nombre, objetivo, silencio, actual }, resumen: `${a.accion} ${ses[0].nombre}` };
    },
    async run(a, r) {
      const pids = (r.pids || []).filter((p) => Number.isInteger(p) && p >= 0);
      if (!pids.length) return { ok: false, mensaje: 'No hay ninguna sesión de audio que cambiar.' };
      let n;
      try {
        const res = await bridge.request('audio.app', { pids, nivel: r.objetivo == null ? -1 : r.objetivo, silencio: r.silencio }, { module: 'audio-control', timeout: 30000 });
        n = res && res.afectadas;
      } catch (e) { return { ok: false, mensaje: 'No pude cambiar el audio de ' + r.nombre + ': ' + e.message }; }
      if (!n) return { ok: false, mensaje: `Windows no encontró la sesión de audio de ${r.nombre} (puede que la app ya no tenga sonido abierto).` };
      let d2;
      try { d2 = await leerAudio(bridge, 'salida'); } catch { return { ok: true, verified: false, mensaje: `Cambié el audio de ${r.nombre}, pero no pude comprobar cómo quedó.` }; }
      const ahora = (d2.apps || []).filter((x) => pids.includes(x.pid));
      const okVol = r.objetivo == null || (ahora.length > 0 && ahora.every((x) => x.volumen != null && Math.abs(x.volumen - r.objetivo) <= 1));
      const okMute = r.silencio < 0 || (ahora.length > 0 && ahora.every((x) => x.silenciada === (r.silencio === 1)));
      const vol = ahora.length ? Math.max(...ahora.map((x) => (x.volumen == null ? 0 : x.volumen))) : null;
      const partes = [];
      if (r.objetivo != null) partes.push(`Volumen de ${r.nombre}: ${r.actual}% → ${vol == null ? r.objetivo : vol}%`);
      if (r.silencio === 1) partes.push(`${r.nombre} quedó silenciada`);
      if (r.silencio === 0) partes.push(`${r.nombre} ya tiene sonido otra vez`);
      if (okVol && okMute) return { ok: true, verified: true, mensaje: partes.join('. ') + '.' };
      return { ok: true, verified: false, mensaje: `Pedí el cambio para ${r.nombre}, pero Windows no muestra el resultado esperado (${partes.join('. ')}).` };
    },
  });

  registry.register({
    name: 'audio_cambiar_dispositivo',
    risk: 'safe', // se cambia directo (sin pedir confirmación) y se comprueba; si algo sale mal, se vuelve a cambiar al instante
    description: 'Cambia el dispositivo de SALIDA de audio predeterminado del PC. Hay tres destinos habituales: los parlantes/altavoces de la laptop (dispositivo: laptop), los auriculares o audífonos con cable (dispositivo: auriculares) y los audífonos inalámbricos o Corsair (dispositivo: inalambricos). Úsala cuando pidan "pasa el sonido a los parlantes", "usa los auriculares", "ponlo en los inalámbricos", "pásalo a los Corsair". También acepta parte del nombre de otro dispositivo (hdmi…). Se hace directo, sin pedir confirmación, y la herramienta ya devuelve la frase final (“Se ha cambiado a …”). Si el nombre es ambiguo o ya es el predeterminado, no hace nada y lo dice.',
    schema: {
      properties: { dispositivo: { type: 'string', maxLength: 80, description: 'laptop (parlantes de la laptop), auriculares (con cable), inalambricos (o corsair), o parte del nombre de otro dispositivo como hdmi' } },
      required: ['dispositivo'],
    },
    async plan(a) {
      let d;
      try { d = await leerAudio(bridge, 'salida'); } catch (e) { return { fail: 'No pude leer el audio de Windows: ' + e.message }; }
      const devs = d.dispositivos || [];
      if (!devs.length) return { fail: 'Windows no muestra ningún dispositivo de salida activo.' };
      let needle = norm(a.dispositivo);
      if (!needle) return { fail: 'Dime a qué dispositivo.' };
      const nombres = devs.map((x) => x.nombre).join(', ');
      const porCat = porCategoria(devs, a.dispositivo);
      let match;
      if (porCat) {
        match = porCat.match;
        if (!match.length) return { fail: `No encuentro ${porCat.cat.nombre} entre los dispositivos activos. Windows solo muestra los que están conectados y encendidos. Ahora veo: ${nombres}.` };
      } else {
        needle = ALIAS_DEV[needle] || needle;
        match = devs.filter((x) => norm(x.nombre).includes(needle));
        if (!match.length) return { fail: `No encuentro un dispositivo llamado «${a.dispositivo}». Los activos son: ${nombres}.` };
      }
      if (match.length > 1) return { clarify: { motivo: `«${a.dispositivo}» coincide con varios dispositivos.`, opciones: match.map((x) => x.nombre) } };
      const dest = match[0];
      const actual = devs.find((x) => x.predeterminado);
      if (dest.predeterminado) return { fail: `Ya estás usando ${etiquetaSalida(dest)}.` };
      if (!ID_RE.test(String(dest.id))) return { fail: 'Windows dio un identificador de dispositivo que no reconozco; no cambio nada.' };
      return { resolved: { id: dest.id, nombre: etiquetaSalida(dest), anterior: actual ? etiquetaSalida(actual) : '', anteriorId: actual ? actual.id : '' }, resumen: `Cambiar la salida de audio${actual ? ' de ' + etiquetaSalida(actual) : ''} a ${etiquetaSalida(dest)}` };
    },
    async run(a, r) {
      if (!ID_RE.test(String(r.id))) return { ok: false, mensaje: 'Identificador de dispositivo no válido.' };
      try { await bridge.request('audio.dispositivo', { id: r.id }, { module: 'audio-control', timeout: 30000 }); }
      catch (e) { return { ok: false, mensaje: 'No pude cambiar el dispositivo: ' + e.message + ' No se cambió nada.' }; }
      let d2;
      try { d2 = await leerAudio(bridge, 'salida'); } catch { return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero no pude comprobar el resultado.` }; }
      const def = (d2.dispositivos || []).find((x) => x.predeterminado);
      if (def && def.id === r.id) { if (r.anteriorId && r.anteriorId !== r.id) anterior.salida = { id: r.anteriorId, nombre: r.anterior }; return { ok: true, verified: true, mensaje: `Se ha cambiado a ${r.nombre}.` }; }
      return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero Windows sigue mostrando ${def ? etiquetaSalida(def) : 'otro dispositivo'} como predeterminado.` };
    },
  });

  // Micrófonos (dispositivo de ENTRADA): mismo mecanismo y mismas garantías que la salida (plan → cambio directo → verificación)
  const leerMics = async () => {
    const d = await leerAudio(bridge, 'entrada');
    const todos = d.dispositivos || [];
    const mapa = clasificarEntradas(todos);
    return { todos, mapa, devs: todos.filter((x) => mapa.get(x) !== 'mezcla') }; // la «mezcla estéreo» no es un micrófono
  };
  const listaMics = (devs) => devs.map((x) => `«${x.nombre}»`).join(', ');

  registry.register({
    name: 'audio_cambiar_microfono',
    risk: 'safe', // se cambia directo (sin pedir confirmación) y se comprueba
    description: 'Cambia el MICRÓFONO (dispositivo de ENTRADA de audio) predeterminado del PC. Hay tres destinos habituales: el micrófono de la laptop (dispositivo: laptop), el micrófono externo o USB (dispositivo: externo) y el micrófono de los audífonos inalámbricos o Corsair (dispositivo: auriculares). También acepta parte del nombre del micrófono. Úsala cuando pidan “pasa al micrófono de la laptop”, “usa el micrófono externo” o “usa el micrófono de los audífonos/Corsair”. Se hace directo, sin pedir confirmación, y la herramienta ya devuelve la frase final (“Se ha cambiado a …”). Para cambiar la SALIDA (parlantes o auriculares) usa audio_cambiar_dispositivo.',
    schema: {
      properties: { dispositivo: { type: 'string', maxLength: 80, description: 'laptop (micrófono de la laptop), externo (USB), auriculares (audífonos inalámbricos o Corsair), o parte del nombre del micrófono' } },
      required: ['dispositivo'],
    },
    async plan(a) {
      let m;
      try { m = await leerMics(); } catch (e) { return { fail: 'No pude leer el audio de Windows: ' + e.message }; }
      const { todos, mapa, devs } = m;
      if (!devs.length) return { fail: 'Windows no muestra ningún micrófono activo.' };
      const q = norm(a.dispositivo);
      if (!q) return { fail: 'Dime a qué micrófono.' };
      let cat = null;
      if (/inalambric|wireless|bluetooth|corsair|airpods|buds|auricular|audifono|headset|casco|diadema/.test(q)) cat = 'auriculares';
      else if (/laptop|portatil|integrad|interno|compu|\bpc\b|array|matriz/.test(q)) cat = 'laptop';
      else if (/externo|usb|jack|conector|afuera/.test(q)) cat = 'externo';
      let match;
      if (cat) {
        match = devs.filter((x) => mapa.get(x) === cat);
        if (!match.length) return { fail: `No tengo identificado ${ETIQUETA_ENTRADA[cat]}. Los micrófonos activos son: ${listaMics(devs)}. Dime cuál es, por ejemplo: «el micrófono Realtek es el de la laptop», y lo recordaré. (Windows solo muestra los micrófonos que están conectados y encendidos.)` };
      } else {
        match = devs.filter((x) => norm(x.nombre).includes(q));
        if (!match.length) return { fail: `No encuentro un micrófono llamado «${a.dispositivo}». Los activos son: ${listaMics(devs)}.` };
      }
      if (match.length > 1) return { clarify: { motivo: `«${a.dispositivo}» coincide con varios micrófonos.`, opciones: match.map((x) => x.nombre) } };
      const dest = match[0];
      const actual = todos.find((x) => x.predeterminado);
      if (dest.predeterminado) return { fail: `Ya estás usando ${etiquetaMic(dest, mapa)}.` };
      if (!ID_RE.test(String(dest.id))) return { fail: 'Windows dio un identificador de dispositivo que no reconozco; no cambio nada.' };
      return { resolved: { id: dest.id, nombre: etiquetaMic(dest, mapa), anterior: actual ? etiquetaMic(actual, mapa) : '', anteriorId: actual ? actual.id : '' }, resumen: `Cambiar el micrófono${actual ? ' de ' + etiquetaMic(actual, mapa) : ''} a ${etiquetaMic(dest, mapa)}` };
    },
    async run(a, r) {
      if (!ID_RE.test(String(r.id))) return { ok: false, mensaje: 'Identificador de dispositivo no válido.' };
      try { await bridge.request('audio.dispositivo', { id: r.id }, { module: 'audio-control', timeout: 30000 }); }
      catch (e) { return { ok: false, mensaje: 'No pude cambiar el micrófono: ' + e.message + ' No se cambió nada.' }; }
      let m;
      try { m = await leerMics(); } catch { return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero no pude comprobar el resultado.` }; }
      const def = m.todos.find((x) => x.predeterminado);
      if (def && def.id === r.id) { if (r.anteriorId && r.anteriorId !== r.id) anterior.entrada = { id: r.anteriorId, nombre: r.anterior }; return { ok: true, verified: true, mensaje: `Se ha cambiado a ${r.nombre}.` }; }
      return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero Windows sigue mostrando ${def ? etiquetaMic(def, m.mapa) : 'otro micrófono'} como predeterminado.` };
    },
  });

  // Enseñarle cuál micrófono es cuál (solo guarda una etiqueta en dispositivos-audio.json; no cambia el audio)
  registry.register({
    name: 'audio_asignar_microfono',
    risk: 'safe',
    description: 'ENSEÑA a Radex cuál micrófono es cuál; no cambia el audio, solo guarda una etiqueta. Úsala cuando el usuario diga qué micrófono es cada uno: “el micrófono Realtek es el de la laptop”, “el USB es el externo”, “el Corsair es el de los audífonos”. rol: laptop, externo o auriculares (audífonos inalámbricos o Corsair). dispositivo: parte del nombre que Windows le da al micrófono. Si no sabe los nombres, primero usa audio_estado con direccion entrada para listarlos.',
    schema: {
      properties: {
        dispositivo: { type: 'string', maxLength: 80, description: 'Parte del nombre del micrófono tal como lo llama Windows (por ejemplo realtek, usb, corsair)' },
        rol: { type: 'string', enum: ['laptop', 'externo', 'auriculares'], description: 'laptop = integrado; externo = USB u otro externo; auriculares = audífonos inalámbricos o Corsair' },
      },
      required: ['dispositivo', 'rol'],
    },
    async plan(a) {
      let m;
      try { m = await leerMics(); } catch (e) { return { fail: 'No pude leer el audio de Windows: ' + e.message }; }
      const q = norm(a.dispositivo);
      if (!q) return { fail: 'Dime qué micrófono.' };
      if (!ROLES_ENTRADA.includes(a.rol)) return { fail: 'El rol debe ser laptop, externo o auriculares.' };
      const match = m.devs.filter((x) => norm(x.nombre).includes(q));
      if (!match.length) return { fail: `No encuentro un micrófono llamado «${a.dispositivo}». Los activos son: ${listaMics(m.devs)}.` };
      if (match.length > 1) return { clarify: { motivo: `«${a.dispositivo}» coincide con varios micrófonos.`, opciones: match.map((x) => x.nombre) } };
      return { resolved: { id: String(match[0].id || ''), nombre: match[0].nombre, rol: a.rol }, resumen: `${a.rol}: ${match[0].nombre}` };
    },
    async run(a, r) {
      try {
        const otros = leerAlias().filter((x) => x.rol !== r.rol && !(x.id && x.id === r.id) && norm(x.nombre) !== norm(r.nombre)); // un micrófono por rol
        guardarAlias([...otros, { rol: r.rol, nombre: r.nombre, id: ID_RE.test(r.id) ? r.id : '' }]);
      } catch (e) { return { ok: false, mensaje: 'No pude guardarlo: ' + e.message }; }
      let m;
      try { m = await leerMics(); } catch { return { ok: true, verified: false, mensaje: `Guardé «${r.nombre}» como ${ETIQUETA_ENTRADA[r.rol]}, pero no pude comprobarlo.` }; }
      const dev = m.devs.find((x) => norm(x.nombre) === norm(r.nombre));
      if (dev && m.mapa.get(dev) === r.rol) return { ok: true, verified: true, mensaje: `Listo: «${r.nombre}» queda registrado como ${ETIQUETA_ENTRADA[r.rol]}. Ya puedo cambiar a él cuando me lo pidas.` };
      return { ok: true, verified: false, mensaje: `Guardé la etiqueta, pero no pude comprobar que «${r.nombre}» quede como ${ETIQUETA_ENTRADA[r.rol]}.` };
    },
  });

  // ---- Silencio temporal del micrófono: el temporizador vive aquí (en el programa principal), así funciona aunque Radex no pueda oírte ----
  // ---- Volumen recordado por dispositivo: el que tenía al silenciarlo o al ajustarlo; se restaura al reactivarlo si algo lo movió ----
  const archivoVol = () => { const d = dirDatos(); return d ? path.join(d, 'volumenes-audio.json') : null; };
  function leerVols() { const f = archivoVol(); if (!f) return {}; try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return d && typeof d.items === 'object' && d.items ? d.items : {}; } catch { return {}; } }
  function recordarVol(id, vol, nombre) {
    const f = archivoVol(); if (!f || !ID_RE.test(String(id)) || !Number.isFinite(vol) || vol < 0 || vol > 100) return;
    try {
      const items = leerVols(); items[id] = { vol: Math.round(vol), nombre: String(nombre || '').slice(0, 80) };
      const ks = Object.keys(items); if (ks.length > 40) delete items[ks[0]];
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.tmp', JSON.stringify({ v: 1, items }, null, 1), 'utf8'); fs.renameSync(f + '.tmp', f);
    } catch {}
  }
  const volRecordado = (id) => { const x = leerVols()[id]; return x && Number.isFinite(x.vol) && x.vol > 0 ? x.vol : null; };
  const temporales = new Map(); // id del micrófono → { timer, hasta, nombre }
  let avisar = () => {};
  const duracionTexto = (s) => {
    if (s < 60) return `${s} ${s === 1 ? 'segundo' : 'segundos'}`;
    if (s < 3600) { const m = Math.floor(s / 60), x = s % 60; return `${m} ${m === 1 ? 'minuto' : 'minutos'}` + (x ? ` y ${x} segundos` : ''); }
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h} ${h === 1 ? 'hora' : 'horas'}` + (m ? ` y ${m} minutos` : '');
  };
  const archivoTemporal = () => { const d = dirDatos(); return d ? path.join(d, 'silencio-temporal.json') : null; };
  // Se guarda qué micrófonos están en silencio temporal: si Radex se cierra o falla, al abrir se reactivan (o se retoma el tiempo que faltaba)
  function guardarTemporales() {
    const f = archivoTemporal(); if (!f) return;
    try {
      if (!temporales.size) { try { fs.unlinkSync(f); } catch {} return; }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.tmp', JSON.stringify({ v: 1, items: [...temporales].map(([id, t]) => ({ id, hasta: t.hasta, nombre: t.nombre })) }), 'utf8');
      fs.renameSync(f + '.tmp', f);
    } catch {}
  }
  function cancelarTemporal(id) { const t = temporales.get(id); if (t) { clearTimeout(t.timer); temporales.delete(id); guardarTemporales(); } }
  function programar(id, nombre, ms) {
    const prev = temporales.get(id); if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => { reactivar(id, nombre); }, ms);
    if (timer.unref) timer.unref();
    temporales.set(id, { timer, hasta: Date.now() + ms, nombre });
    guardarTemporales();
  }
  // ---- Estado visible en pantalla: qué entradas/salidas están silenciadas (y cuánto falta si es temporal) ----
  let emitirEstado = () => {}, ultimoEstado = '', sondeo = null;
  async function estadoSilencios() {
    const sil = (dir, L) => L.todos.filter((x) => x.silenciado === true).map((x) => {
      const t = temporales.get(x.id);
      return { dir, id: x.id, nombre: L.etiqueta(x), nombreWindows: x.nombre || '', predeterminado: !!x.predeterminado, hasta: t ? t.hasta : null };
    });
    const en = (L) => { const d = L.todos.find((x) => x.predeterminado); return d ? { id: d.id, nombre: L.etiqueta(d), nombreWindows: d.nombre || '', silenciado: d.silenciado === true } : null; };
    const items = [], uso = {};
    const LE = await leerDisp('entrada'), LS = await leerDisp('salida');
    items.push(...sil('entrada', LE)); items.push(...sil('salida', LS));
    uso.entrada = en(LE); uso.salida = en(LS); // lo que el equipo (Windows) tiene en uso ahora
    return { items, uso };
  }
  let notificando = false;
  async function notificarEstado() {
    if (notificando) return; notificando = true;
    try {
      const e = await estadoSilencios();
      const k = JSON.stringify([e.items.map((x) => [x.id, x.hasta]), e.uso && e.uso.entrada && e.uso.entrada.id, e.uso && e.uso.salida && e.uso.salida.id]);
      if (k !== ultimoEstado) { ultimoEstado = k; emitirEstado(e); }
    } catch {} finally { notificando = false; }
  }
  function iniciarSondeo() { // revisa cada 8 s: también ve lo que silencias a mano en Windows
    if (sondeo) return;
    sondeo = setInterval(() => { notificarEstado(); }, 8000);
    if (sondeo.unref) sondeo.unref();
    notificarEstado();
  }
  async function reactivar(id, nombre) {
    cancelarTemporal(id);
    let ok = false;
    for (let i = 0; i < 2 && !ok; i++) {
      try {
        let antes = (await leerMics()).todos.find((x) => x.id === id);
        if (!antes) antes = ((await leerAudio(bridge, 'salida')).dispositivos || []).find((x) => x.id === id);
        const rec = volRecordado(id);
        const nivel = rec != null && antes && antes.volumen != null && Math.abs(antes.volumen - rec) > 2 ? rec : -1; // solo si algo lo movió mientras estaba en silencio
        await bridge.request('audio.nivel_dispositivo', { id, nivel, silencio: 0 }, { module: 'audio-control', timeout: 30000 });
        let dv = (await leerMics()).todos.find((x) => x.id === id);
        if (!dv) dv = ((await leerAudio(bridge, 'salida')).dispositivos || []).find((x) => x.id === id);
        ok = !!dv && dv.silenciado === false;
      } catch {}
    }
    try { avisar(ok ? `Micrófono activado otra vez${nombre ? ' (' + nombre + ')' : ''}.` : `No pude reactivar el micrófono${nombre ? ' (' + nombre + ')' : ''}. Escríbeme «activa el micrófono» o actívalo en Windows.`); } catch {}
    notificarEstado();
    return ok;
  }
  async function recuperar() { // al abrir Radex: reactiva (o retoma) lo que quedó en silencio temporal
    const f = archivoTemporal(); if (!f) return;
    let items = []; try { items = JSON.parse(fs.readFileSync(f, 'utf8')).items || []; } catch { return; }
    try { fs.unlinkSync(f); } catch {}
    for (const it of items) {
      if (!it || !ID_RE.test(String(it.id))) continue;
      const resta = Number(it.hasta) - Date.now();
      if (resta > 1500) programar(it.id, it.nombre || '', resta); else await reactivar(it.id, it.nombre || '');
    }
  }
  async function liberar() { for (const [id, t] of [...temporales]) await reactivar(id, t.nombre); } // al cerrar Radex
  tempCtl = {
    recuperar, liberar, hayTemporales: () => temporales.size > 0,
    setAvisar: (fn) => { avisar = typeof fn === 'function' ? fn : () => {}; },
    setEstado: (fn) => { emitirEstado = typeof fn === 'function' ? fn : () => {}; ultimoEstado = ''; },
    estado: async () => { try { const e = await estadoSilencios(); ultimoEstado = JSON.stringify([e.items.map((x) => [x.id, x.hasta]), e.uso && e.uso.entrada && e.uso.entrada.id, e.uso && e.uso.salida && e.uso.salida.id]); return e; } catch { return { items: [], uso: {} }; } },
    iniciarSondeo,
  };

  // ---- Volumen y silencio de UN dispositivo (el que está en uso, uno concreto o todos), de entrada o de salida ----
  const leerDisp = async (dir) => {
    if (dir === 'entrada') { const m = await leerMics(); return { todos: m.todos, devs: m.devs, mapa: m.mapa, etiqueta: (x) => etiquetaMic(x, m.mapa) }; }
    const d = await leerAudio(bridge, 'salida'); const todos = Array.isArray(d.dispositivos) ? d.dispositivos : [];
    return { todos, devs: todos, mapa: null, etiqueta: (x) => etiquetaSalida(x) };
  };
  // Qué dispositivo(s) pide el usuario: vacío o «en uso» = el predeterminado; «todos» = todos los activos; categoría o parte del nombre = ese
  function elegirDisp(dir, L, texto) {
    const q = norm(texto), cosa = dir === 'entrada' ? 'micrófono' : 'dispositivo de salida';
    if (!q || /^(en uso|actual|predeterminado|principal|el que uso|el que estoy usando)$/.test(q)) {
      const def = L.todos.find((x) => x.predeterminado);
      return def ? { lista: [def], enUso: true } : { fail: `Windows no muestra ningún ${cosa} en uso.` };
    }
    if (/\b(todos|todas)\b/.test(q)) return L.devs.length ? { lista: L.devs.slice() } : { fail: `Windows no muestra ningún ${cosa} activo.` };
    let match;
    if (dir === 'entrada') {
      let cat = null;
      if (/inalambric|wireless|bluetooth|corsair|airpods|buds|auricular|audifono|headset|casco|diadema/.test(q)) cat = 'auriculares';
      else if (/laptop|portatil|integrad|interno|compu|\bpc\b|array|matriz/.test(q)) cat = 'laptop';
      else if (/externo|usb|jack|conector|afuera/.test(q)) cat = 'externo';
      if (cat) {
        match = L.devs.filter((x) => L.mapa.get(x) === cat);
        if (!match.length) return { fail: `No tengo identificado ${ETIQUETA_ENTRADA[cat]}. Los micrófonos activos son: ${listaMics(L.devs)}. Dime cuál es, por ejemplo: «el micrófono Realtek es el de la laptop», y lo recordaré.` };
      } else match = L.devs.filter((x) => norm(x.nombre).includes(q));
      if (!match.length) return { fail: `No encuentro un micrófono llamado «${texto}». Los activos son: ${listaMics(L.devs)}.` };
    } else {
      const pc = porCategoria(L.devs, texto);
      if (pc) {
        match = pc.match;
        if (!match.length) return { fail: `No encuentro ${pc.cat.nombre} entre los dispositivos activos. Ahora veo: ${L.devs.map((x) => x.nombre).join(', ')}.` };
      } else {
        const needle = ALIAS_DEV[q] || q;
        match = L.devs.filter((x) => norm(x.nombre).includes(needle));
        if (!match.length) return { fail: `No encuentro un dispositivo llamado «${texto}». Los activos son: ${L.devs.map((x) => x.nombre).join(', ')}.` };
      }
    }
    if (match.length > 1) return { clarify: { motivo: `«${texto}» coincide con varios dispositivos.`, opciones: match.map((x) => x.nombre) } };
    return { lista: match };
  }

  function registrarNivel(name, dir, description, dispDesc) {
    const entrada = dir === 'entrada', cosa = entrada ? 'micrófono' : 'salida';
    registry.register({
      name, risk: 'safe', description,
      schema: {
        properties: {
          dispositivo: { type: 'string', maxLength: 80, description: dispDesc },
          accion: { type: 'string', enum: ['establecer', 'subir', 'bajar', 'silenciar', 'activar_sonido'], description: 'establecer necesita porcentaje; subir y bajar usan paso (10 por defecto)' },
          porcentaje: { type: 'integer', minimum: 0, maximum: 100, description: 'Volumen de 0 a 100 (solo con establecer)' },
          paso: { type: 'integer', minimum: 1, maximum: 100, description: 'Cuánto subir o bajar (por defecto 10)' },
          segundos: { type: 'integer', minimum: 1, maximum: 43200, description: 'Solo con silenciar: silencio temporal. Pasados estos segundos se reactiva solo (máximo 12 horas)' },
        },
        required: ['accion'],
      },
      async plan(a) {
        let L;
        try { L = await leerDisp(dir); } catch (e) { return { fail: 'No pude leer el audio de Windows: ' + e.message }; }
        const sel = elegirDisp(dir, L, a.dispositivo);
        if (sel.fail || sel.clarify) return sel;
        for (const d of sel.lista) if (!ID_RE.test(String(d.id))) return { fail: 'Windows dio un identificador de dispositivo que no reconozco; no cambio nada.' };
        let objetivo = null, silencio = -1;
        if (a.accion === 'establecer') { if (a.porcentaje == null) return { fail: 'Falta el porcentaje de volumen (0 a 100).' }; objetivo = a.porcentaje; }
        else if (a.accion === 'silenciar') silencio = 1;
        else if (a.accion === 'activar_sonido') silencio = 0;
        else if (a.accion !== 'subir' && a.accion !== 'bajar') return { fail: 'Acción no válida.' };
        const paso = a.paso || 10;
        const objetivos = sel.lista.map((d) => {
          const actual = d.volumen == null ? 0 : d.volumen;
          let nivel = a.accion === 'subir' ? Math.min(100, actual + paso) : a.accion === 'bajar' ? Math.max(0, actual - paso) : objetivo, restaurar = false;
          if (a.accion === 'activar_sonido') { const rec = volRecordado(d.id); if (rec != null && d.volumen != null && Math.abs(d.volumen - rec) > 2) { nivel = rec; restaurar = true; } } // el volumen cambió mientras estaba en silencio: vuelve al de antes
          return { id: d.id, nombre: L.etiqueta(d), actual, nivel, restaurar, yaSilenciado: d.silenciado === true };
        });
        const quien = objetivos.length > 1 ? `todos (${objetivos.length})` : objetivos[0].nombre;
        return { resolved: { dir, enUso: !!sel.enUso, objetivos, silencio, segundos: a.accion === 'silenciar' && a.segundos ? a.segundos : 0 }, resumen: `${a.accion} ${cosa} ${quien}` };
      },
      async run(a, r) {
        const obj = r.objetivos || [];
        if (!obj.length || obj.some((o) => !ID_RE.test(String(o.id)))) return { ok: false, mensaje: 'Identificador de dispositivo no válido.' };
        if (r.silencio === 1) for (const o of obj) if (!o.yaSilenciado && o.actual > 0) recordarVol(o.id, o.actual, o.nombre); // el volumen que tenía justo antes de silenciar
        for (const o of obj) {
          try { await bridge.request('audio.nivel_dispositivo', { id: o.id, nivel: o.nivel == null ? -1 : o.nivel, silencio: r.silencio }, { module: 'audio-control', timeout: 30000 }); }
          catch (e) { return { ok: false, mensaje: `No pude cambiar ${entrada ? 'el micrófono' : 'la salida'} (${o.nombre}): ${e.message}` }; }
          // Silencio temporal: el temporizador se arma ya (aunque falle la comprobación) para que nunca quede silenciado de más
          if (r.silencio === 1 && r.segundos) programar(o.id, o.nombre, r.segundos * 1000);
          else if (r.silencio >= 0) cancelarTemporal(o.id); // silencio permanente, o activar el sonido: se anula cualquier temporizador
        }
        notificarEstado();
        let L2;
        try { L2 = await leerDisp(dir); } catch { return { ok: true, verified: false, mensaje: `Cambié ${entrada ? 'el micrófono' : 'la salida'} (${obj.map((o) => o.nombre).join(', ')}), pero no pude comprobar cómo quedó.` }; }
        let todoOk = true; const partes = [];
        for (const o of obj) {
          const ahora = L2.todos.find((x) => x.id === o.id);
          const okVol = o.nivel == null || (!!ahora && ahora.volumen != null && Math.abs(ahora.volumen - o.nivel) <= (entrada ? 3 : 1)); // los micrófonos suben por pasos algo más gruesos
          const okMute = r.silencio < 0 || (!!ahora && ahora.silenciado === (r.silencio === 1));
          if (!(okVol && okMute)) todoOk = false;
          if (okVol && o.nivel != null && !o.restaurar && r.silencio < 0) recordarVol(o.id, ahora.volumen == null ? o.nivel : ahora.volumen, o.nombre); // ajuste hecho a propósito: es el nuevo volumen a recordar
          if (o.restaurar) partes.push(`Volumen de ${o.nombre} restaurado al ${ahora && ahora.volumen != null ? ahora.volumen : o.nivel}% (había cambiado a ${o.actual}%)`);
          else if (o.nivel != null) partes.push(r.enUso && entrada ? `El micrófono en uso (${o.nombre}) está ahora al ${ahora && ahora.volumen != null ? ahora.volumen : o.nivel}% (antes ${o.actual}%)` : `Volumen de ${o.nombre}: ${o.actual}% → ${ahora && ahora.volumen != null ? ahora.volumen : o.nivel}%`);
        }
        const lista = obj.map((o) => o.nombre).join(', ');
        const sujeto = entrada ? 'Micrófono' : 'Salida', silenciado = entrada ? 'silenciado' : 'silenciada', activado = entrada ? 'activado' : 'activada';
        if (r.silencio === 1) partes.push(r.segundos ? `${sujeto} ${silenciado} por ${duracionTexto(r.segundos)} (${lista}). Se reactivará solo` : `${sujeto} ${silenciado} (${lista})`);
        if (r.silencio === 0) partes.push(`${sujeto} ${activado} otra vez (${lista})`);
        if (todoOk) return { ok: true, verified: true, mensaje: partes.join('. ') + '.' };
        return { ok: true, verified: false, mensaje: `Pedí el cambio (${lista}), pero Windows no muestra el resultado esperado.` };
      },
    });
  }
  registrarNivel('audio_microfono_volumen', 'entrada',
    'Cambia el volumen o el silencio de un MICRÓFONO (dispositivo de ENTRADA); no toca el volumen de salida. Sin «dispositivo» actúa sobre el micrófono en uso (el predeterminado de Windows). Úsala con “silencia el micrófono”, “activa el micrófono”, “sube / baja el micrófono”, “pon el micrófono al 80”, y también para uno concreto: “silencia el micrófono externo”, “silencia el micrófono de la laptop”, “silencia el micrófono de los audífonos” (dispositivo: externo / laptop / auriculares) o “silencia todos los micrófonos” (dispositivo: todos). Para el volumen de los parlantes o del PC usa ajustar_volumen o audio_salida_volumen; para cambiar de micrófono usa audio_cambiar_microfono. Silenciar un micrófono en Windows lo silencia para todas las aplicaciones (Discord, Zoom…) y, si es el que está en uso, también para Radex, que no podrá oír hasta que se reactive. SILENCIO TEMPORAL: si el usuario dice una duración (“silencia el micrófono por 5 segundos / 2 minutos / una hora”), usa silenciar con segundos (conviértela: 5 segundos → 5; 2 minutos → 120; una hora → 3600) y el micrófono se reactiva solo.',
    'Opcional. Vacío = el micrófono en uso. laptop (micrófono de la laptop), externo (USB), auriculares (audífonos inalámbricos o Corsair), todos (todos los micrófonos) o parte del nombre del micrófono');
  registrarNivel('audio_salida_volumen', 'salida',
    'Cambia el volumen o el silencio de un dispositivo de SALIDA concreto (parlantes de la laptop, auriculares con cable, audífonos inalámbricos/Corsair, HDMI…) sin cambiar cuál es el predeterminado. Úsala con “silencia los audífonos inalámbricos”, “silencia los parlantes de la laptop”, “quita el silencio de los auriculares”, “silencia todas las salidas” (dispositivo: laptop / auriculares / inalambricos / todos / parte del nombre). Sin «dispositivo» actúa sobre la salida en uso. Si solo piden subir, bajar o silenciar “el volumen” del PC sin nombrar un dispositivo, usa ajustar_volumen. Admite silencio temporal con segundos.',
    'Opcional. Vacío = la salida en uso. laptop (parlantes de la laptop), auriculares (con cable), inalambricos (o corsair), todos, o parte del nombre del dispositivo');

  // Qué está silenciado ahora mismo (entradas y salidas) y, si es temporal, cuánto falta
  registry.register({
    name: 'audio_silenciados',
    risk: 'safe',
    description: 'SOLO LECTURA: dice qué dispositivos de audio están SILENCIADOS ahora mismo, tanto micrófonos (entrada) como salidas (parlantes, auriculares), y cuánto falta para que se reactiven si el silencio es temporal. Úsala con “¿qué tengo silenciado?”, “¿qué micrófono está silenciado?”, “¿qué salida está silenciada?”, “¿hay algo en silencio?”. cual: entrada, salida o ambos (por defecto ambos).',
    schema: { properties: { cual: { type: 'string', enum: ['ambos', 'salida', 'entrada'], description: 'entrada = micrófonos; salida = parlantes/auriculares; ambos = los dos (por defecto)' } }, required: [] },
    async run(a) {
      const cual = a.cual === 'salida' || a.cual === 'entrada' ? a.cual : 'ambos';
      const dirs = cual === 'ambos' ? ['entrada', 'salida'] : [cual];
      const partes = [];
      for (const dir of dirs) {
        let L;
        try { L = await leerDisp(dir); } catch (e) { return { ok: false, mensaje: 'No pude leer el audio de Windows: ' + e.message }; }
        const sil = L.todos.filter((x) => x.silenciado === true);
        const titulo = dir === 'entrada' ? 'Micrófonos' : 'Salidas';
        if (!sil.length) { partes.push(`${titulo}: ninguno está silenciado`); continue; }
        partes.push(`${titulo} silenciados: ` + sil.map((x) => {
          const t = temporales.get(x.id);
          const falta = t ? Math.max(1, Math.round((t.hasta - Date.now()) / 1000)) : 0;
          return L.etiqueta(x) + (x.predeterminado ? ' (en uso)' : '') + (t ? `, se reactiva en ${duracionTexto(falta)}` : '');
        }).join('; '));
      }
      notificarEstado();
      return { ok: true, verified: true, mensaje: partes.join('. ') + '.' };
    },
  });

  // Volver al dispositivo de antes (salida o micrófono): recuerda el último cambio hecho desde que Radex está abierto
  registry.register({
    name: 'audio_volver_anterior',
    risk: 'safe',
    description: 'Vuelve al dispositivo de audio que se estaba usando ANTES del último cambio hecho con Radex (salida o micrófono). Úsala con “regrésame al micrófono de antes”, “vuelve a los altavoces de antes”, “deshaz el cambio de audio”. cual: salida (parlantes/auriculares) o entrada (micrófono). Solo recuerda el último cambio mientras Radex siga abierto.',
    schema: { properties: { cual: { type: 'string', enum: ['salida', 'entrada'], description: 'salida = parlantes/auriculares; entrada = micrófono' } }, required: ['cual'] },
    async plan(a) {
      const dir = a.cual === 'entrada' ? 'entrada' : 'salida';
      const ant = anterior[dir];
      if (!ant) return { fail: `No tengo guardado a qué ${dir === 'entrada' ? 'micrófono' : 'salida'} volver: solo recuerdo el último cambio que hice desde que abrí Radex.` };
      let d;
      try { d = await leerAudio(bridge, dir); } catch (e) { return { fail: 'No pude leer el audio de Windows: ' + e.message }; }
      const todos = d.dispositivos || [];
      const dest = todos.find((x) => x.id === ant.id);
      if (!dest) return { fail: `Ya no veo ${ant.nombre} entre los dispositivos activos (¿está desconectado o apagado?).` };
      if (dest.predeterminado) return { fail: `Ya estás usando ${ant.nombre}.` };
      if (!ID_RE.test(String(dest.id))) return { fail: 'Windows dio un identificador de dispositivo que no reconozco; no cambio nada.' };
      const mapa = dir === 'entrada' ? clasificarEntradas(todos) : null;
      const etiqueta = (x) => (dir === 'entrada' ? etiquetaMic(x, mapa) : etiquetaSalida(x));
      const actual = todos.find((x) => x.predeterminado);
      return { resolved: { id: dest.id, dir, nombre: etiqueta(dest), anteriorId: actual ? actual.id : '', anterior: actual ? etiqueta(actual) : '' }, resumen: `Volver a ${etiqueta(dest)}` };
    },
    async run(a, r) {
      if (!ID_RE.test(String(r.id))) return { ok: false, mensaje: 'Identificador de dispositivo no válido.' };
      try { await bridge.request('audio.dispositivo', { id: r.id }, { module: 'audio-control', timeout: 30000 }); }
      catch (e) { return { ok: false, mensaje: 'No pude volver al dispositivo anterior: ' + e.message + ' No se cambió nada.' }; }
      let d2;
      try { d2 = await leerAudio(bridge, r.dir); } catch { return { ok: true, verified: false, mensaje: `Pedí volver a ${r.nombre}, pero no pude comprobar el resultado.` }; }
      const def = (d2.dispositivos || []).find((x) => x.predeterminado);
      if (def && def.id === r.id) {
        anterior[r.dir] = r.anteriorId && r.anteriorId !== r.id ? { id: r.anteriorId, nombre: r.anterior } : null; // «vuelve» otra vez te lleva de regreso
        return { ok: true, verified: true, mensaje: `Se ha vuelto a ${r.nombre}.` };
      }
      return { ok: true, verified: false, mensaje: `Pedí volver a ${r.nombre}, pero Windows sigue mostrando otro dispositivo como predeterminado.` };
    },
  });
  return tempCtl;
};
