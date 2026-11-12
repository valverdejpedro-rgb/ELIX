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
