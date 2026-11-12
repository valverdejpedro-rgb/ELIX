const { webFrame, contextBridge, ipcRenderer } = require('electron');

// Electron no trae el reconocimiento de voz de Google: lo quitamos para que
// ELIX use su modo alterno de escucha (Gemini) automáticamente.
webFrame.executeJavaScript(
  'try{delete window.SpeechRecognition;delete window.webkitSpeechRecognition;}catch(e){}'
);

// Puente seguro hacia el control de navegadores (proceso principal)
contextBridge.exposeInMainWorld('elixBrowser', {
  run: (accion, args) => ipcRenderer.invoke('browser:run', accion, args),
});

// Versión instalada y estado de las actualizaciones
contextBridge.exposeInMainWorld('elixApp', {
  info: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('app:check'),
  installNow: () => ipcRenderer.invoke('app:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
});

// Acciones de PC (abrir apps, carpetas, volumen, multimedia, info, bloquear)
const NATIVE_NAMES = ['abrir_aplicacion', 'abrir_carpeta', 'ajustar_volumen', 'control_multimedia', 'info_del_sistema', 'bloquear_pc', 'controlar_ventana'];
contextBridge.exposeInMainWorld('jarvisNative', Object.fromEntries(
  NATIVE_NAMES.map((n) => [n, (input) => ipcRenderer.invoke('native:run', n, input || {})])
));
