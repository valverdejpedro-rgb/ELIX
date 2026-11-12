const { webFrame, contextBridge, ipcRenderer } = require('electron');

// Electron no trae el reconocimiento de voz de Google: lo quitamos para que
// Radex use su modo de escucha en la nube (Groq Whisper o Gemini) automáticamente.
webFrame.executeJavaScript(
  'try{delete window.SpeechRecognition;delete window.webkitSpeechRecognition;}catch(e){}'
);

// Puente seguro hacia el control de navegadores (proceso principal)
contextBridge.exposeInMainWorld('elixBrowser', {
  run: (accion, args) => ipcRenderer.invoke('browser:run', accion, args),
});

// Red hacia los proveedores de IA (la hace el proceso principal)
contextBridge.exposeInMainWorld('elixNet', {
  fetch: (req) => ipcRenderer.invoke('net:fetch', req),
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
