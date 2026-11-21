'use strict';
// Nombres amigables para los dispositivos de audio de Windows (salida y entrada).
// Windows los llama cosas como «Microphone Array (Realtek(R) Audio)»; aquí se reconocen por categoría
// para poder decir «el micrófono de la laptop» y para elegir destino con «laptop / externo / audífonos».
// Si Windows pone un nombre que no se reconoce, el usuario puede enseñarlo («el micrófono Realtek es el de la laptop»):
// se guarda en dispositivos-audio.json (junto a memoria.json) y manda sobre cualquier suposición.
const fs = require('fs');
const path = require('path');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const INALAMB = /corsair|wireless|bluetooth|hands.?free|airpods|buds|inalambric|\bbt\b/;
const HEADSET = /headset|auricular|audifono|headphone|casco|diadema/;
const MEZCLA = /mezcla|stereo mix|what u hear|loopback/; // «mezcla estéreo»: entrada falsa que graba lo que suena; nunca se usa
const EXTERNO = /usb|extern|webcam|camara|yeti|snowball|quadcast|fifine|samson|rode|elgato|at2020|seiren/;
const LAPTOP_MIC = /array|matriz|integrad|internal|interno|built.?in|dmic|digital mic|micro\w* digital|laptop|portatil|realtek|conexant|amd audio|smart sound|high definition|hd audio/;
const ROLES_ENTRADA = ['laptop', 'externo', 'auriculares'];

// ---- Lo que el usuario enseñó (dispositivos-audio.json) ----
let dir = null;
const setDir = (d) => { dir = d || null; };
const dirDatos = () => dir;
const archivoAlias = () => (dir ? path.join(dir, 'dispositivos-audio.json') : null);
function leerAlias() {
  const f = archivoAlias(); if (!f) return [];
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    return (Array.isArray(d.entrada) ? d.entrada : []).filter((x) => x && ROLES_ENTRADA.includes(x.rol) && typeof x.nombre === 'string');
  } catch { return []; }
}
function guardarAlias(lista) {
  const f = archivoAlias(); if (!f) throw new Error('El archivo de dispositivos no está disponible todavía.');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, entrada: lista.slice(0, 20) }, null, 1), 'utf8');
  fs.renameSync(tmp, f);
}

// ---- Entrada (micrófonos): 'auriculares' (inalámbricos, Corsair o headset), 'laptop' (integrado), 'externo' (USB…), 'mezcla' (se ignora) o null (no reconocido) ----
// Se clasifica el CONJUNTO: lo enseñado manda; después los nombres; y si solo queda uno sin reconocer, se deduce por descarte.
function clasificarEntradas(devs) {
  const alias = leerAlias();
  const mapa = new Map();
  for (const d of devs) {
    const n = norm(d.nombre);
    const a = alias.find((x) => (x.id && d.id && x.id === d.id) || norm(x.nombre) === n);
    let c = null;
    if (a) c = a.rol;
    else if (MEZCLA.test(n)) c = 'mezcla';
    else if (INALAMB.test(n) || HEADSET.test(n)) c = 'auriculares';
    else if (EXTERNO.test(n)) c = 'externo';
    else if (LAPTOP_MIC.test(n)) c = 'laptop';
    mapa.set(d, c);
  }
  const sin = devs.filter((d) => mapa.get(d) === null);
  if (sin.length === 1) {
    const cs = [...mapa.values()];
    if (!cs.includes('laptop')) mapa.set(sin[0], 'laptop');
    else if (!cs.includes('externo')) mapa.set(sin[0], 'externo');
  }
  return mapa;
}
const ETIQUETA_ENTRADA = { auriculares: 'el micrófono de los audífonos', laptop: 'el micrófono de la laptop', externo: 'el micrófono externo' };

// ---- Nombres directos para decir en voz alta: «micrófono externo ETHOS 101», «audífonos inalámbricos CORSAIR»… ----
const MARCAS = { corsair: 'CORSAIR', hyperx: 'HyperX', logitech: 'Logitech', razer: 'Razer', steelseries: 'SteelSeries', redragon: 'Redragon', jbl: 'JBL', sony: 'Sony', airpods: 'AirPods', jabra: 'Jabra', bose: 'Bose', anker: 'Anker', soundcore: 'Soundcore', beats: 'Beats', xiaomi: 'Xiaomi', samsung: 'Samsung', huawei: 'Huawei' };
function marcaDe(nombre) { const n = norm(nombre); for (const k of Object.keys(MARCAS)) if (n.includes(k)) return MARCAS[k]; return ''; }
const GENERICAS = new Set(['usb', 'audio', 'device', 'dispositivo', 'dispositivos', 'microphone', 'microfono', 'micro', 'mic', 'headset', 'headphone', 'headphones', 'auricular', 'auriculares', 'audifono', 'audifonos', 'altavoz', 'altavoces', 'speaker', 'speakers', 'realtek', 'high', 'definition', 'gaming', 'receiver', 'wireless', 'hands', 'free', 'handsfree', 'stereo', 'rgb', 'digital', 'array', 'interno', 'integrado', 'pnp', 'sound', 'de', 'la', 'el', 'r', 'tm']);
// «Micrófono (ETHOS 101)» → «ETHOS 101». Si solo trae palabras genéricas («USB Audio Device») → vacío.
function modeloDe(nombre) {
  const raw = String(nombre || ''), m = raw.match(/\((.*)\)\s*$/);
  const base = (m ? m[1] : raw).replace(/\((?:R|TM)\)/gi, ' ');
  return base.split(/\s+/).filter((w) => { const k = norm(w); return k && !GENERICAS.has(k); }).join(' ').trim().slice(0, 40);
}
function etiquetaMic(dev, mapa) {
  const c = mapa ? mapa.get(dev) : null, nombre = (dev && dev.nombre) || '';
  if (c === 'laptop') return 'micrófono de la laptop';
  // Sin marcas ni modelos (Realtek, Corsair, ETHOS…): solo el tipo de dispositivo
  if (c === 'auriculares') return INALAMB.test(norm(nombre)) ? 'audífonos inalámbricos' : 'audífonos';
  if (c === 'externo') return 'micrófono externo';
  return 'otro micrófono';
}

// ---- Salida (altavoces/auriculares) ----
function categoriaSalida(nombre) {
  const n = norm(nombre);
  if (INALAMB.test(n)) return 'inalambrico';
  if (/auricular|headphone|audifono|headset/.test(n)) return 'cable';
  if (/altavo(?:z|ces)|speaker|parlante|bocina/.test(n) && !/hdmi|nvidia|displayport|monitor|digital|spdif|usb/.test(n)) return 'laptop';
  return null;
}
const ETIQUETA_SALIDA = { inalambrico: 'los audífonos inalámbricos', cable: 'los altavoces externos', laptop: 'los parlantes de la laptop' };
function etiquetaSalida(dev) {
  const nombre = (dev && dev.nombre) || '', c = categoriaSalida(nombre);
  if (c === 'laptop') return 'altavoces de la laptop';
  if (c === 'inalambrico') return 'audífonos inalámbricos';
  if (c === 'cable') return 'altavoces externos';
  if (/hdmi|displayport|nvidia|monitor|digital|spdif/.test(norm(nombre))) return 'la salida del monitor';
  return 'otro dispositivo de salida';
}

module.exports = { norm, setDir, dirDatos, leerAlias, guardarAlias, clasificarEntradas, etiquetaMic, etiquetaSalida, modeloDe, marcaDe, categoriaSalida, ETIQUETA_ENTRADA, ETIQUETA_SALIDA, ROLES_ENTRADA };
