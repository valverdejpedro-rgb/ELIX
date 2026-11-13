'use strict';
// Punto de entrada del módulo de herramientas. No usa Electron: así se puede probar con `node selftest.js`.
// Cada etapa añade su módulo aquí (una línea por módulo).
const { createRegistry } = require('./registry');
const { createBridge } = require('./psbridge');

const registry = createRegistry();
const bridge = createBridge();

require('./diagnostic')(registry, bridge);
require('./audio')(registry, bridge); // etapa 2: audio de solo lectura
require('./audio-control')(registry, bridge); // etapa 3: volumen por app y dispositivo de salida
// Etapas siguientes (aún no incluidas):
//   require('./apps')(registry, bridge);
//   require('./browser-tools')(registry, bridge);

module.exports = {
  init: ({ logFile } = {}) => registry.setLogFile(logFile || null),
  catalog: () => registry.catalog(),
  run: (name, args) => registry.invoke(name, args),
  confirm: (accept) => registry.confirm(!!accept),
  shutdown: () => bridge.stop(),
  registry, bridge,
};
