'use strict';
// Etapa 3: cambia el audio. Volumen/silencio de UNA aplicación (seguro: se verifica y es fácil de revertir)
// y dispositivo de salida predeterminado (pide confirmación por voz).
// Siempre se resuelve primero qué app o dispositivo es (plan); si hay duda, no se hace nada y se pregunta.
// Después de actuar se vuelve a leer Windows para comprobar que quedó así (VERIFICADO).
const { leerAudio } = require('./audio');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ALIAS_APP = { 'google chrome': 'chrome', 'microsoft edge': 'msedge', edge: 'msedge', sistema: 'sonidos del sistema', sonidos: 'sonidos del sistema' };
const ALIAS_DEV = { parlantes: 'altavoces', bocinas: 'altavoces', speakers: 'altavoces', audifonos: 'auriculares', headphones: 'auriculares', cascos: 'auriculares' };
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
    risk: 'confirm',
    description: 'Cambia el dispositivo de SALIDA de audio predeterminado del PC (auriculares, altavoces, HDMI…). Úsala cuando pidan "pasa el sonido a los altavoces", "usa los auriculares". Si el nombre es ambiguo o ya es el predeterminado, no hace nada y lo dice.',
    schema: {
      properties: { dispositivo: { type: 'string', maxLength: 80, description: 'Nombre o parte del nombre del dispositivo (por ejemplo auriculares, altavoces, hdmi)' } },
      required: ['dispositivo'],
    },
    async plan(a) {
      let d;
      try { d = await leerAudio(bridge, 'salida'); } catch (e) { return { fail: 'No pude leer el audio de Windows: ' + e.message }; }
      const devs = d.dispositivos || [];
      if (!devs.length) return { fail: 'Windows no muestra ningún dispositivo de salida activo.' };
      let needle = norm(a.dispositivo);
      needle = ALIAS_DEV[needle] || needle;
      if (!needle) return { fail: 'Dime a qué dispositivo.' };
      const nombres = devs.map((x) => x.nombre).join(', ');
      const match = devs.filter((x) => norm(x.nombre).includes(needle));
      if (!match.length) return { fail: `No encuentro un dispositivo llamado «${a.dispositivo}». Los activos son: ${nombres}.` };
      if (match.length > 1) return { clarify: { motivo: `«${a.dispositivo}» coincide con varios dispositivos.`, opciones: match.map((x) => x.nombre) } };
      const dest = match[0];
      const actual = devs.find((x) => x.predeterminado);
      if (dest.predeterminado) return { fail: `«${dest.nombre}» ya es el dispositivo de salida predeterminado.` };
      if (!ID_RE.test(String(dest.id))) return { fail: 'Windows dio un identificador de dispositivo que no reconozco; no cambio nada.' };
      return { resolved: { id: dest.id, nombre: dest.nombre, anterior: actual ? actual.nombre : '' }, resumen: `Voy a cambiar la salida de audio predeterminada${actual ? ` de «${actual.nombre}»` : ''} a «${dest.nombre}»` };
    },
    async run(a, r) {
      if (!ID_RE.test(String(r.id))) return { ok: false, mensaje: 'Identificador de dispositivo no válido.' };
      try { await bridge.request('audio.dispositivo', { id: r.id }, { module: 'audio-control', timeout: 30000 }); }
      catch (e) { return { ok: false, mensaje: 'No pude cambiar el dispositivo: ' + e.message + ' No se cambió nada.' }; }
      let d2;
      try { d2 = await leerAudio(bridge, 'salida'); } catch { return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero no pude comprobar el resultado.` }; }
      const def = (d2.dispositivos || []).find((x) => x.predeterminado);
      if (def && def.id === r.id) return { ok: true, verified: true, mensaje: `Listo: la salida de audio ahora es ${r.nombre}.` };
      return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero Windows sigue mostrando ${def ? def.nombre : 'otro dispositivo'} como predeterminado.` };
    },
  });
};
