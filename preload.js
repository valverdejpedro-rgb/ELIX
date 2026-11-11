// Electron no trae el reconocimiento de voz de Google: lo quitamos para que
// ELIX use su modo alterno de escucha (Gemini) automáticamente.
const { webFrame } = require('electron');
webFrame.executeJavaScript(
  'try{delete window.SpeechRecognition;delete window.webkitSpeechRecognition;}catch(e){}'
);
