'use strict';
// Etapa 3: cambia el audio. Volumen/silencio de UNA aplicación (seguro: se verifica y es fácil de revertir)
// y dispositivo de salida predeterminado (pide confirmación por voz).
// Siempre se resuelve primero qué app o dispositivo es (plan); si hay duda, no se hace nada y se pregunta.
// Después de actuar se vuelve a leer Windows para comprobar que quedó así (VERIFICADO).
const { leerAudio } = require('./audio');
const { clasificarEntradas, ETIQUETA_ENTRADA, ROLES_ENTRADA, etiquetaMic, etiquetaSalida, leerAlias, guardarAlias } = require('./audio-nombres');

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
      return { resolved: { id: dest.id, nombre: etiquetaSalida(dest), anterior: actual ? etiquetaSalida(actual) : '' }, resumen: `Cambiar la salida de audio${actual ? ' de ' + etiquetaSalida(actual) : ''} a ${etiquetaSalida(dest)}` };
    },
    async run(a, r) {
      if (!ID_RE.test(String(r.id))) return { ok: false, mensaje: 'Identificador de dispositivo no válido.' };
      try { await bridge.request('audio.dispositivo', { id: r.id }, { module: 'audio-control', timeout: 30000 }); }
      catch (e) { return { ok: false, mensaje: 'No pude cambiar el dispositivo: ' + e.message + ' No se cambió nada.' }; }
      let d2;
      try { d2 = await leerAudio(bridge, 'salida'); } catch { return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero no pude comprobar el resultado.` }; }
      const def = (d2.dispositivos || []).find((x) => x.predeterminado);
      if (def && def.id === r.id) return { ok: true, verified: true, mensaje: `Se ha cambiado a ${r.nombre}.` };
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
      return { resolved: { id: dest.id, nombre: etiquetaMic(dest, mapa) }, resumen: `Cambiar el micrófono${actual ? ' de ' + etiquetaMic(actual, mapa) : ''} a ${etiquetaMic(dest, mapa)}` };
    },
    async run(a, r) {
      if (!ID_RE.test(String(r.id))) return { ok: false, mensaje: 'Identificador de dispositivo no válido.' };
      try { await bridge.request('audio.dispositivo', { id: r.id }, { module: 'audio-control', timeout: 30000 }); }
      catch (e) { return { ok: false, mensaje: 'No pude cambiar el micrófono: ' + e.message + ' No se cambió nada.' }; }
      let m;
      try { m = await leerMics(); } catch { return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero no pude comprobar el resultado.` }; }
      const def = m.todos.find((x) => x.predeterminado);
      if (def && def.id === r.id) return { ok: true, verified: true, mensaje: `Se ha cambiado a ${r.nombre}.` };
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
};
