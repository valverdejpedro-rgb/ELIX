'use strict';
// Nombres amigables para los dispositivos de audio de Windows (salida y entrada).
// Windows los llama cosas como «Microphone Array (Realtek(R) Audio)»; aquí se reconocen por categoría
// para poder decir «el micrófono de la laptop» y para elegir destino con «laptop / externo / audífonos».
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const INALAMB = /corsair|wireless|bluetooth|hands.?free|airpods|buds|inalambric|\bbt\b/;
const HEADSET = /headset|auricular|audifono|headphone|casco|diadema/;
const MEZCLA = /mezcla|stereo mix|what u hear|loopback/; // «mezcla estéreo»: entrada falsa que graba lo que suena; nunca se usa
const LAPTOP_MIC = /array|matriz|integrad|internal|interno|built.?in|dmic|digital mic|micro\w* digital|laptop|portatil/;

// Entrada (micrófonos): 'auriculares' (inalámbricos, Corsair o headset), 'laptop' (integrado) o 'externo' (USB o de conector). 'mezcla' se ignora.
function categoriaEntrada(nombre) {
  const n = norm(nombre);
  if (MEZCLA.test(n)) return 'mezcla';
  if (INALAMB.test(n) || HEADSET.test(n)) return 'auriculares';
  if (LAPTOP_MIC.test(n)) return 'laptop';
  return 'externo';
}
const ETIQUETA_ENTRADA = { auriculares: 'el micrófono de los audífonos', laptop: 'el micrófono de la laptop' };
// Texto para decir un micrófono en voz alta (los externos se nombran tal como los llama Windows)
const decirMicrofono = (dev) => {
  const c = categoriaEntrada(dev && dev.nombre);
  return ETIQUETA_ENTRADA[c] || `el micrófono externo «${(dev && dev.nombre) || 'sin nombre'}»`;
};

// Salida (altavoces/auriculares)
function categoriaSalida(nombre) {
  const n = norm(nombre);
  if (INALAMB.test(n)) return 'inalambrico';
  if (/auricular|headphone|audifono|headset/.test(n)) return 'cable';
  if (/altavo(?:z|ces)|speaker|parlante|bocina/.test(n) && !/hdmi|nvidia|displayport|monitor|digital|spdif|usb/.test(n)) return 'laptop';
  return null;
}
const ETIQUETA_SALIDA = { inalambrico: 'los audífonos inalámbricos', cable: 'los auriculares con cable', laptop: 'los parlantes de la laptop' };

module.exports = { norm, categoriaEntrada, categoriaSalida, ETIQUETA_ENTRADA, ETIQUETA_SALIDA, decirMicrofono };
