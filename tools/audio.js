'use strict';
// Etapa 2: audio de SOLO LECTURA. Consulta a Windows (Core Audio, vía native/audio.ps1) qué dispositivos hay,
// su volumen y silencio, y qué aplicaciones están sonando. No cambia nada en el PC.
// Lee el estado del audio de Windows (también lo usa la etapa 3 para resolver y verificar)
async function leerAudio(bridge, direccion) {
  const r = await bridge.request('audio.leer', { direccion: direccion === 'entrada' ? 'entrada' : 'salida' }, { module: 'audio', timeout: 30000 });
  try { return JSON.parse(r && r.json); } catch { throw new Error('Windows devolvió datos de audio que no pude entender.'); }
}

function registerAudio(registry, bridge) {
  const ESTADO = { 0: 'inactiva', 1: 'activa' };
  const SUENA = 2; // pico (0-100) a partir del cual se considera que algo está sonando

  registry.register({
    name: 'audio_estado',
    risk: 'safe',
    description: 'SOLO LECTURA: informa del audio del PC: dispositivos de salida (o de entrada/micrófono), volumen y silencio de cada uno, y qué aplicaciones tienen sonido y cuáles están sonando ahora mismo (con su volumen). Úsala cuando pregunten qué está sonando, qué app hace ruido, qué dispositivo de audio se está usando o cuánto volumen tiene una app. No cambia nada. Para solo saber el volumen general del PC también sirve ajustar_volumen con accion consultar.',
    schema: {
      properties: {
        direccion: { type: 'string', enum: ['salida', 'entrada'], description: 'salida = altavoces/auriculares (por defecto); entrada = micrófonos' },
      },
      required: [],
    },
    async run(args) {
      const direccion = args.direccion === 'entrada' ? 'entrada' : 'salida';
      let d;
      try { d = await leerAudio(bridge, direccion); }
      catch (e) { return { ok: false, mensaje: 'No pude leer el audio de Windows: ' + e.message }; }
      return { ok: true, verified: true, ...resumir(d) };
    },
  });

  function resumir(d) {
    const devs = Array.isArray(d.dispositivos) ? d.dispositivos : [];
    const apps = Array.isArray(d.apps) ? d.apps : [];
    const salida = d.direccion !== 'entrada';
    if (!devs.length) return { mensaje: salida ? 'Windows no muestra ningún dispositivo de salida de audio activo.' : 'Windows no muestra ningún micrófono activo.' };

    const def = devs.find((x) => x.predeterminado) || devs[0];
    const vol = (x) => (x.volumen == null ? 'volumen desconocido' : `volumen ${x.volumen}%`) + (x.silenciado ? ', SILENCIADO' : '');
    const partes = [`${salida ? 'Dispositivo de salida predeterminado' : 'Micrófono predeterminado'}: ${def.nombre || '(sin nombre)'}, ${vol(def)}`];
    if (salida) partes.push(def.pico >= SUENA ? 'por él está saliendo sonido ahora mismo' : 'por él no sale sonido en este momento');
    else partes.push(def.pico >= SUENA ? 'el micrófono está captando sonido' : 'el micrófono no capta sonido en este momento');
    const otros = devs.filter((x) => x !== def);
    if (otros.length) partes.push('otros dispositivos activos: ' + otros.map((x) => `${x.nombre || '(sin nombre)'} (${vol(x)})`).join('; '));

    if (salida) {
      // Una app "suena" si su medidor marca señal; las demás solo tienen la sesión abierta
      const suenan = apps.filter((a) => a.pico >= SUENA && !a.silenciada);
      const resto = apps.filter((a) => !suenan.includes(a));
      const fmt = (a) => `${a.nombre} (${a.volumen == null ? 'volumen desconocido' : a.volumen + '%'}${a.silenciada ? ', silenciada' : ''})`;
      partes.push(suenan.length ? 'Sonando ahora: ' + suenan.map(fmt).join(', ') : 'Ninguna aplicación está sonando ahora mismo');
      if (resto.length) partes.push('con sesión de audio pero sin sonar: ' + resto.map((a) => `${fmt(a)}${ESTADO[a.estado] ? ' [' + ESTADO[a.estado] + ']' : ''}`).join(', '));
    }
    const detalle = JSON.stringify({ dispositivos: devs.map(({ nombre, volumen, silenciado, predeterminado, pico }) => ({ nombre, volumen, silenciado, predeterminado, pico })), apps: apps.map(({ nombre, volumen, silenciada, pico }) => ({ nombre, volumen, silenciada, pico })) });
    return { mensaje: partes.join('. ') + '.', detalle: 'Datos: ' + detalle.slice(0, 1500) };
  }
}

module.exports = registerAudio;
module.exports.leerAudio = leerAudio;
