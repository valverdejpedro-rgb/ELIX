'use strict';
// Etapa 4: MEMORIA PERSISTENTE. Guarda en un archivo local (memoria.json, junto al registro de acciones, en la
// carpeta de datos de la app) lo que el usuario pide recordar: procesos (pasos de cómo hacer algo), datos y preferencias.
//  - Solo se guarda cuando el usuario lo pide ("recuerda que...", "guarda este proceso..."): nada se guarda a escondidas.
//  - Nunca se guardan contraseñas, claves de API ni números largos (tarjetas).
//  - Cada operación vuelve a leer el archivo para comprobar el resultado (verified:true solo si quedó escrito).
//  - Olvidar pide confirmación por voz, igual que las demás acciones de riesgo.
const fs = require('fs');
const path = require('path');

const MAX_ITEMS = 100;
const TIPOS = ['proceso', 'dato', 'preferencia'];
const SECRETO = /(contrase[ñn]a|password|passwd|api[ _-]?key|token|secret|gsk_[a-z0-9]|AIza[0-9A-Za-z_-]{10,}|\b\d{13,19}\b)/i;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const una = (s) => String(s || '').replace(/\s+/g, ' ').trim();

module.exports = function registerMemoria(registry) {
  let dir = null;
  const file = () => (dir ? path.join(dir, 'memoria.json') : null);

  function load() {
    const f = file();
    if (!f) throw new Error('La memoria no está disponible todavía.');
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    try {
      const d = JSON.parse(raw);
      return Array.isArray(d.items) ? d.items.filter((x) => x && x.id && x.titulo && x.texto) : [];
    } catch {
      try { fs.renameSync(f, f + '.dañado'); } catch {} // archivo corrupto: se aparta (no se pierde) y se empieza limpio
      return [];
    }
  }
  function save(items) {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, items }, null, 1), 'utf8');
    fs.renameSync(tmp, f);
  }
  const linea = (x) => `- [${x.tipo}] ${x.titulo}: ${x.texto}`;

  function buscar(items, q) {
    const n = norm(q);
    if (!n) return items;
    const exact = items.filter((x) => norm(x.titulo) === n);
    if (exact.length) return exact;
    const toks = n.split(' ').filter((t) => t.length >= 3);
    if (!toks.length) return items.filter((x) => norm(x.titulo + ' ' + x.texto).includes(n));
    return items.filter((x) => { const h = norm(x.titulo + ' ' + x.texto); return toks.some((t) => h.includes(t)); });
  }

  registry.register({
    name: 'memoria_guardar',
    risk: 'safe',
    description: 'Guarda en la memoria permanente algo que el usuario pidió recordar ("recuerda que…", "guarda este proceso…", "apunta que…"). tipo: proceso (pasos de cómo hacer algo), dato (un hecho) o preferencia (cómo le gusta algo). titulo: nombre corto y claro. texto: el contenido completo, con los pasos en orden si es un proceso. Si ya existe un recuerdo con ese título, lo actualiza. NO guardes contraseñas ni claves. Solo úsala cuando el usuario lo pida.',
    schema: {
      properties: {
        tipo: { type: 'string', enum: TIPOS, description: 'proceso, dato o preferencia (por defecto dato)' },
        titulo: { type: 'string', maxLength: 60, description: 'Nombre corto del recuerdo' },
        texto: { type: 'string', maxLength: 600, description: 'Contenido completo del recuerdo' },
      },
      required: ['titulo', 'texto'],
    },
    async run(a) {
      const titulo = una(a.titulo), texto = una(a.texto), tipo = a.tipo || 'dato';
      if (SECRETO.test(titulo + ' ' + texto)) return { ok: false, mensaje: 'No guardo contraseñas, claves ni números largos como tarjetas, por seguridad.' };
      const items = load();
      const i = items.findIndex((x) => norm(x.titulo) === norm(titulo));
      const item = { id: i >= 0 ? items[i].id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo, titulo, texto, t: new Date().toISOString() };
      if (i >= 0) items[i] = item;
      else {
        if (items.length >= MAX_ITEMS) return { ok: false, mensaje: `La memoria está llena (${MAX_ITEMS} recuerdos). Dime cuál quieres olvidar.` };
        items.push(item);
      }
      save(items);
      const check = load().find((x) => x.id === item.id);
      return { ok: true, verified: !!(check && check.texto === texto), mensaje: (i >= 0 ? 'Actualizado en mi memoria: ' : 'Guardado en mi memoria: ') + `"${titulo}".` };
    },
  });

  registry.register({
    name: 'memoria_consultar',
    risk: 'safe',
    description: 'SOLO LECTURA: lista lo que hay en la memoria permanente, o busca por palabras si se indica "busqueda". Úsala cuando el usuario pregunte qué recuerdas, cómo se hacía un proceso, o algo que pudo haberte pedido guardar.',
    schema: { properties: { busqueda: { type: 'string', maxLength: 80, description: 'Palabras a buscar (opcional; sin esto lista todo)' } }, required: [] },
    async run(a) {
      const items = load();
      const r = buscar(items, a.busqueda);
      if (!r.length) return { ok: true, verified: true, mensaje: items.length ? 'No encontré recuerdos con eso.' : 'Todavía no tengo recuerdos guardados.' };
      return { ok: true, verified: true, mensaje: `${r.length} recuerdo(s).`, detalle: r.map(linea).join('\n') };
    },
  });

  registry.register({
    name: 'memoria_olvidar',
    risk: 'confirm',
    description: 'Borra un recuerdo de la memoria permanente por su título. Solo cuando el usuario pida olvidar algo.',
    schema: { properties: { titulo: { type: 'string', maxLength: 60, description: 'Título (o parte) del recuerdo a olvidar' } }, required: ['titulo'] },
    async plan(a) {
      const r = buscar(load(), a.titulo);
      if (!r.length) return { fail: 'No encuentro ningún recuerdo con ese nombre.' };
      if (r.length > 1) return { clarify: { motivo: 'Hay varios recuerdos que coinciden.', opciones: r.map((x) => x.titulo) } };
      return { resolved: { id: r[0].id, titulo: r[0].titulo }, resumen: `Olvidar el recuerdo "${r[0].titulo}"` };
    },
    async run(a, res) {
      const items = load();
      if (!items.some((x) => x.id === res.id)) return { ok: false, mensaje: 'Ese recuerdo ya no existe.' };
      save(items.filter((x) => x.id !== res.id));
      return { ok: true, verified: !load().some((x) => x.id === res.id), mensaje: `Olvidé "${res.titulo}".` };
    },
  });

  return { setDir: (d) => { dir = d || null; } };
};
