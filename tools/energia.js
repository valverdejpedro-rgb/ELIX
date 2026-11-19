'use strict';
// Planes de energía de Windows (Alto rendimiento, GAMER, Equilibrado…): listar y cambiar el plan activo.
//  - Usa solo powercfg.exe, que ya viene con Windows, con argumentos fijos (nunca se arma texto con lo que dice el modelo).
//  - El nombre del plan se busca SOLO entre los planes reales que Windows lista; el identificador (GUID) se valida antes de usarlo.
//  - Después de cambiar, vuelve a preguntar cuál quedó activo: VERIFICADO solo si coincide.
//  - Es un comando puntual (dura una fracción de segundo): no deja ningún proceso corriendo ni consulta nada por su cuenta.
const { execFile } = require('child_process');

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LINEA = new RegExp('(' + GUID.source + ')\\s+\\((.+?)\\)\\s*(\\*)?\\s*$', 'i');
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function ejecutar(file, args, enc) {
  return new Promise((res, rej) => {
    execFile(file, args, { windowsHide: true, timeout: 8000, encoding: enc || 'utf8', maxBuffer: 256 * 1024 }, (err, out, errout) => {
      if (err) return rej(new Error(String(errout || err.message || err).split('\n')[0].trim().slice(0, 160) || 'powercfg falló'));
      res(String(out || ''));
    });
  });
}
// Primero con la consola en UTF-8 (para que los acentos salgan bien); si eso falla, powercfg directo
async function defaultExec(args) {
  if (process.platform !== 'win32') throw new Error('Los planes de energía solo existen en Windows.');
  try { return await ejecutar(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'chcp 65001>nul & powercfg ' + args.join(' ')], 'utf8'); }
  catch { return ejecutar('powercfg.exe', args, 'latin1'); }
}

module.exports = function registerEnergia(registry, opts = {}) {
  const exec = opts.exec || defaultExec; // exec(['/list']) → texto; opts.exec solo se usa en pruebas

  async function leerPlanes() {
    const out = await exec(['/list']);
    const planes = [];
    for (const l of out.split(/\r?\n/)) {
      const m = l.trim().match(LINEA);
      if (m) planes.push({ id: m[1].toLowerCase(), nombre: m[2].trim(), activo: !!m[3] });
    }
    if (!planes.length) throw new Error('No pude leer los planes de energía de Windows.');
    return planes;
  }
  async function planActivoId() {
    const m = (await exec(['/getactivescheme'])).match(GUID);
    return m ? m[0].toLowerCase() : '';
  }
  const lista = (ps) => ps.map((p) => `«${p.nombre}»`).join(', ');

  registry.register({
    name: 'energia_planes',
    risk: 'safe',
    description: 'SOLO LECTURA: dice qué plan de energía de Windows está activo (Alto rendimiento, GAMER, Equilibrado…) y cuáles hay disponibles. Úsala cuando pregunten en qué plan de energía están o qué planes tienen.',
    schema: { properties: {}, required: [] },
    async run() {
      const ps = await leerPlanes();
      const act = ps.find((p) => p.activo);
      return { ok: true, verified: true, mensaje: act ? `El plan de energía activo es ${act.nombre}. Disponibles: ${lista(ps)}.` : `Planes disponibles: ${lista(ps)}.` };
    },
  });

  registry.register({
    name: 'energia_cambiar_plan',
    risk: 'safe', // se cambia directo y se comprueba; se puede volver al plan anterior cambiándolo otra vez
    description: 'Cambia el PLAN DE ENERGÍA de Windows (el perfil de rendimiento de la laptop: Alto rendimiento, GAMER, Equilibrado, Ahorro de energía…). plan: el nombre del plan o parte de él. Úsala cuando pidan cambiar el modo de energía, el plan de energía o el perfil de rendimiento de la batería.',
    schema: { properties: { plan: { type: 'string', maxLength: 60, description: 'Nombre del plan o parte del nombre, por ejemplo: alto rendimiento, gamer, equilibrado' } }, required: ['plan'] },
    async plan(a) {
      let ps; try { ps = await leerPlanes(); } catch (e) { return { fail: e.message }; }
      const n = fold(a.plan); if (!n) return { fail: 'Dime a qué plan de energía.' };
      let m = ps.filter((p) => fold(p.nombre) === n);
      if (!m.length) { const toks = n.split(' ').filter((t) => t.length >= 3); m = ps.filter((p) => { const f = fold(p.nombre); return f.includes(n) || (toks.length > 0 && toks.every((t) => f.includes(t))); }); }
      if (!m.length) return { fail: `No encuentro un plan de energía llamado «${a.plan}». Los que tiene Windows son: ${lista(ps)}.` };
      if (m.length > 1) return { clarify: { motivo: `«${a.plan}» coincide con varios planes.`, opciones: m.map((p) => p.nombre) } };
      const dest = m[0];
      if (!GUID.test(dest.id)) return { fail: 'Windows dio un identificador de plan que no reconozco; no cambio nada.' };
      const act = ps.find((p) => p.activo);
      return { resolved: { id: dest.id, nombre: dest.nombre, ya: !!dest.activo, anterior: act ? act.nombre : '' }, resumen: `Cambiar el plan de energía a ${dest.nombre}` };
    },
    async run(a, r) {
      if (r.ya) return { ok: true, verified: true, mensaje: `El plan de energía ya era ${r.nombre}.` };
      if (!GUID.test(String(r.id))) return { ok: false, mensaje: 'Identificador de plan no válido.' };
      try { await exec(['/setactive', r.id]); }
      catch (e) { return { ok: false, mensaje: 'No pude cambiar el plan de energía: ' + e.message + ' No se cambió nada.' }; }
      let ahora; try { ahora = await planActivoId(); } catch { return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero no pude comprobar el resultado.` }; }
      if (ahora === r.id) return { ok: true, verified: true, mensaje: `Plan de energía cambiado a ${r.nombre}.` };
      return { ok: true, verified: false, mensaje: `Pedí cambiar a ${r.nombre}, pero Windows sigue con otro plan activo.` };
    },
  });
};
