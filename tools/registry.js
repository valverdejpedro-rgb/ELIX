'use strict';
// Registro de herramientas de Radex. Es la ÚNICA puerta por la que la IA puede hacer cosas con este módulo:
//  - lista blanca: solo existen las herramientas registradas aquí;
//  - validación estricta de parámetros (tipos, rangos, enums, sin parámetros extra);
//  - confirmación: las herramientas con risk:'confirm' NO se ejecutan hasta que el usuario responda (por voz);
//    la confirmación la gestiona la app, nunca el modelo;
//  - verificación: el resultado solo se da por "VERIFICADO" si la herramienta volvió a consultar Windows;
//  - registro local de acciones (sin claves ni contraseñas).
//
// Contrato de una herramienta:
//   { name, description, risk: 'safe'|'confirm',
//     schema: { properties: { p: { type, description, enum?, minimum?, maximum?, maxLength?, pattern? } }, required: [] },
//     plan?: async (args) => { clarify:{motivo, opciones} } | { fail:'texto' } | { resolved, resumen },
//     run:  async (args, resolved) => { ok, verified, mensaje, detalle? } }
//   - plan resuelve a qué dispositivo/app se refiere la orden ANTES de pedir confirmación o ejecutar.
//     Si la orden es ambigua devuelve clarify y no se hace nada.
//   - run devuelve verified:true solo si, después de actuar, comprobó el estado real.
const fs = require('fs');
const crypto = require('crypto');

const CONFIRM_TTL_MS = 40000;
const CTRL = /[\u0000-\u001f\u007f]/;
const SECRET_KEY = /(pass|clave|key|token|secret|password|cred)/i;
const LOG_MAX = 512 * 1024;

function validateArgs(schema, raw) {
  const props = (schema && schema.properties) || {};
  const req = (schema && schema.required) || [];
  const bad = (error) => ({ ok: false, error });
  if (raw == null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return bad('Los parámetros deben ser un objeto.');
  for (const k of Object.keys(raw)) if (!Object.prototype.hasOwnProperty.call(props, k)) return bad(`Parámetro no permitido: ${k}.`);
  const out = {};
  for (const [k, p] of Object.entries(props)) {
    let v = raw[k];
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (empty) { if (req.includes(k)) return bad(`Falta el parámetro "${k}".`); continue; }
    switch (p.type) {
      case 'string': {
        if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
        if (typeof v !== 'string') return bad(`"${k}" debe ser texto.`);
        v = v.trim();
        if (v.length > (p.maxLength || 200)) return bad(`"${k}" es demasiado largo.`);
        if (CTRL.test(v)) return bad(`"${k}" contiene caracteres no permitidos.`);
        if (p.enum) {
          const e = p.enum.find((x) => String(x).toLowerCase() === v.toLowerCase());
          if (e === undefined) return bad(`"${k}" debe ser uno de: ${p.enum.join(', ')}.`);
          v = e;
        }
        if (p.pattern instanceof RegExp && !p.pattern.test(v)) return bad(`"${k}" no tiene un formato válido.`);
        break;
      }
      case 'integer':
      case 'number': {
        if (typeof v === 'string') v = Number(v.trim().replace(',', '.'));
        if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`"${k}" debe ser un número.`);
        if (p.type === 'integer') { if (!Number.isInteger(v)) return bad(`"${k}" debe ser un número entero.`); }
        if (p.minimum != null && v < p.minimum) return bad(`"${k}" no puede ser menor que ${p.minimum}.`);
        if (p.maximum != null && v > p.maximum) return bad(`"${k}" no puede ser mayor que ${p.maximum}.`);
        break;
      }
      case 'boolean': {
        if (v === 'true') v = true; else if (v === 'false') v = false;
        if (typeof v !== 'boolean') return bad(`"${k}" debe ser verdadero o falso.`);
        break;
      }
      default: return bad(`Tipo de parámetro no soportado en "${k}".`); // ante la duda, se rechaza
    }
    out[k] = v;
  }
  return { ok: true, args: out };
}

function createRegistry({ logFile = null, ttlMs = CONFIRM_TTL_MS } = {}) {
  const tools = new Map();
  let pending = null;
  let log = logFile;

  function setLogFile(f) { log = f; }

  function audit(entry) {
    if (!log) return;
    try {
      try { if (fs.statSync(log).size > LOG_MAX) fs.renameSync(log, log + '.old'); } catch {}
      fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
    } catch {}
  }
  const clean = (args) => {
    const o = {};
    for (const [k, v] of Object.entries(args || {})) {
      if (SECRET_KEY.test(k)) continue;
      o[k] = typeof v === 'string' ? v.slice(0, 100) : v;
    }
    return o;
  };

  function register(def) {
    if (!def || !/^[a-z][a-z0-9_]{2,48}$/.test(def.name || '')) throw new Error('Nombre de herramienta no válido: ' + (def && def.name));
    if (tools.has(def.name)) throw new Error('Herramienta duplicada: ' + def.name);
    if (!['safe', 'confirm'].includes(def.risk)) throw new Error(`${def.name}: risk debe ser safe o confirm.`);
    if (typeof def.run !== 'function' || typeof def.description !== 'string') throw new Error(`${def.name}: falta run o description.`);
    tools.set(def.name, { schema: { properties: {}, required: [] }, ...def });
  }

  // Lo que ve la IA: nombre, descripción y esquema (solo type/description/enum; sin funciones)
  function catalog() {
    return [...tools.values()].map((d) => {
      const properties = {};
      for (const [k, p] of Object.entries(d.schema.properties || {})) {
        properties[k] = { type: p.type, ...(p.description ? { description: p.description } : {}), ...(p.enum ? { enum: p.enum } : {}) };
      }
      return {
        name: d.name,
        description: d.description + (d.risk === 'confirm' ? ' (Antes de ejecutarse se le pide confirmación por voz al usuario.)' : ''),
        inputSchema: { type: 'object', properties, required: d.schema.required || [] },
      };
    });
  }

  // ---- Resultados: siempre un objeto simple con un texto que la IA debe respetar ----
  const fail = (mensaje) => ({ ok: false, verified: false, mensaje, text: 'FALLÓ: ' + mensaje });
  const done = (r) => {
    const mensaje = String((r && r.mensaje) || 'Hecho.');
    const verified = !!(r && r.ok && r.verified === true); // sin comprobación explícita, nunca cuenta como verificado
    if (!r || !r.ok) return fail(mensaje + (r && r.detalle ? ' ' + r.detalle : ''));
    const extra = r.detalle ? '\n' + r.detalle : '';
    return {
      ok: true, verified, mensaje,
      text: (verified ? 'VERIFICADO: ' : 'HECHO PERO SIN VERIFICAR: ') + mensaje + extra,
    };
  };
  const clarify = (motivo, opciones) => ({
    ok: false, verified: false, clarify: true, mensaje: motivo, opciones: opciones || [],
    text: 'AMBIGUO: ' + motivo + (opciones && opciones.length ? ' Opciones: ' + opciones.join(' | ') + '.' : '')
      + ' No se ejecutó nada: pregúntale al usuario cuál quiere.',
  });

  async function execute(def, args, resolved, estado) {
    const t0 = Date.now();
    let res;
    try { res = done(await def.run(args, resolved)); }
    catch (e) { res = fail(String((e && e.message) || e).split('\n')[0].slice(0, 220)); }
    audit({ tool: def.name, args: clean(args), estado, ok: res.ok, verified: res.verified, ms: Date.now() - t0 });
    return res;
  }

  async function invoke(name, rawArgs) {
    const def = tools.get(String(name));
    if (!def) {
      audit({ tool: String(name).slice(0, 60), estado: 'no-autorizada' });
      return fail('Herramienta no autorizada: ' + String(name).slice(0, 60));
    }
    const v = validateArgs(def.schema, rawArgs);
    if (!v.ok) { audit({ tool: def.name, estado: 'parametros-invalidos', detalle: v.error }); return fail(v.error); }
    let plan = { resolved: v.args, resumen: def.name };
    if (def.plan) {
      try { plan = await def.plan(v.args); }
      catch (e) { return fail(String((e && e.message) || e).split('\n')[0].slice(0, 220)); }
    }
    if (plan && plan.clarify) { audit({ tool: def.name, args: clean(v.args), estado: 'ambiguo' }); return clarify(plan.clarify.motivo, plan.clarify.opciones); }
    if (plan && plan.fail) { audit({ tool: def.name, args: clean(v.args), estado: 'rechazada', detalle: plan.fail }); return fail(plan.fail); }
    if (def.risk === 'confirm') {
      pending = { token: crypto.randomBytes(8).toString('hex'), name: def.name, args: v.args, resolved: plan.resolved, resumen: plan.resumen, exp: Date.now() + ttlMs };
      audit({ tool: def.name, args: clean(v.args), estado: 'pendiente' });
      return {
        ok: false, verified: false, mensaje: plan.resumen,
        pending: { resumen: plan.resumen, ttl: ttlMs },
        text: 'PENDIENTE DE CONFIRMACIÓN: ' + plan.resumen + '. Todavía no se hizo nada. Pregúntale al usuario en una frase si lo confirma y espera su respuesta; no vuelvas a llamar a la herramienta.',
      };
    }
    return execute(def, v.args, plan.resolved, 'ejecutada');
  }

  // La app llama a esto cuando el usuario responde sí/no. El modelo no tiene acceso a esta función.
  async function confirm(accept) {
    const p = pending; pending = null;
    if (!p) return { ...fail('No hay ninguna acción pendiente de confirmar.'), none: true };
    if (!accept) { audit({ tool: p.name, estado: 'cancelada' }); return { ok: true, verified: false, cancelled: true, mensaje: 'Cancelado.', text: 'Cancelado.' }; }
    if (Date.now() > p.exp) { audit({ tool: p.name, estado: 'vencida' }); return { ...fail('La confirmación venció; pídelo de nuevo.'), expired: true }; }
    const def = tools.get(p.name);
    if (!def) return fail('La herramienta ya no está disponible.');
    return execute(def, p.args, p.resolved, 'confirmada');
  }

  return { register, catalog, invoke, confirm, setLogFile, validateArgs, hasPending: () => !!pending };
}

module.exports = { createRegistry, validateArgs };
