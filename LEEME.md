# ELIX de escritorio

## Una sola vez (preparación)
1. Crea un repositorio en GitHub llamado `ELIX` (puede ser público).
2. En `package.json` cambia `TU_USUARIO_GITHUB` por tu usuario de GitHub.
3. Sube esta carpeta al repositorio:
   git init && git add . && git commit -m "ELIX" && git branch -M main
   git remote add origin https://github.com/TU_USUARIO_GITHUB/ELIX.git
   git push -u origin main
4. Publica la primera versión:
   git tag v1.0.0 && git push origin v1.0.0
5. GitHub Actions construye el instalador. Descarga `ELIX Setup 1.0.0.exe`
   desde la pestaña Releases e instálalo (solo esta vez).

## Cada cambio (se actualiza solo)
1. Edita `app/index.html`.
2. Sube la versión en `package.json` (ej. 1.0.1).
3. git add . && git commit -m "cambio" && git push
   git tag v1.0.1 && git push origin v1.0.1
El ELIX ya instalado detecta la versión nueva, la descarga y se reinicia solo.
(La etiqueta debe coincidir con la versión de package.json.)

## Cerebro y oído gratuitos (v1.0.7)
1. Consigue una clave gratis (sin tarjeta) en https://console.groq.com/keys
2. En Radex, doble clic sobre la palabra RADEX para abrir el panel de API.
3. En "Cerebro" elige "Groq (gratis, recomendado)" y pega la clave en "Clave".
   El mismo panel pide la clave de Gemini solo si usas la voz de Gemini.
4. "Oído" en Automático usa Groq Whisper si hay clave de Groq (si no, Gemini).
Radex responde solo cuando empiezas o terminas la orden diciendo "Radex" (ya no queda atento después de responder).

## Probar en local
npm install && npm start

## Avatares (v1.0.8)
Abajo, en las opciones, el selector "Avatar" permite elegir Orbe, Holograma mujer u Holograma hombre.
Las imágenes están en `app/avatars/` (mujer.png y hombre.png, con fondo transparente): puedes reemplazarlas por otras
manteniendo el mismo nombre. También se puede decir "pon el avatar de mujer" por voz.

## Herramientas avanzadas, etapa 2 (v1.0.24)
- Nueva herramienta `audio_estado` (SOLO LECTURA): dice qué dispositivo de audio se usa, su volumen/silencio y qué apps están sonando.
  Código: `native/audio.ps1` (C# con COM de Windows) y `tools/audio.js`. No cambia nada en el PC.
- Confirmación vencida: si dices "sí" cuando ya venció, Radex avisa "esa confirmación ya venció, no hice nada" y nunca ejecuta.
  Tiempo para responder: 5 s desde que Radex termina de preguntar (máximo 10 s desde la orden). Un "sí" o "no" tardío se entiende hasta 15 s después, sin decir "Radex".
- Probar con el .exe instalado: decir "Radex, haz un diagnóstico de las herramientas" (incluye la lectura real del audio) y luego "Radex, ¿qué está sonando?".
- Probar desde el código: `node selftest.js` (la parte [4] lee tu audio real).

## Herramientas avanzadas, etapa 3 (v1.0.26)
- `audio_volumen_app`: sube, baja, establece o silencia el volumen de UNA app ("baja Spotify", "silencia Chrome", "pon Discord al 30").
  Si el nombre es ambiguo o la app no existe, no hace nada y lo dice. Verifica el resultado releyendo Windows.
- `audio_cambiar_dispositivo`: cambia la salida de audio predeterminada ("pasa el sonido a los altavoces"). Pide confirmación por voz.
  Usa una interfaz no documentada de Windows (IPolicyConfig); el diagnóstico dice si está disponible.
- Código: `native/audio-control.ps1` (cambia el audio) separado de `native/audio.ps1` (solo lectura), y `tools/audio-control.js`.
- El diagnóstico ahora da más detalle (dispositivos, volúmenes, apps con audio, si el cambio de dispositivo está disponible).

## Memoria permanente y menos respuestas fantasma (v1.0.30)
- Memoria: ELIX guarda en `memoria.json` (carpeta de datos de la app, junto a `tools-log.jsonl`) lo que le pidas recordar:
  procesos (pasos de cómo hacer algo), datos y preferencias. Ejemplos: "Radex, recuerda este proceso: para subir cambios…",
  "¿qué recuerdas?", "¿cómo era el proceso de…?", "Radex, olvida el proceso de…" (esto último pide confirmación por voz).
  Nunca guarda contraseñas, claves ni números largos. No guarda nada si no se lo pides. Código: `tools/memoria.js`.
- Modo conversación (ya existía): di "Radex" una vez y sigue atento sin repetir el nombre; "Radex, desactívate" lo duerme.
- Corregido: respuestas "¿en qué puedo ayudarte?" sin que nadie hable. Causas atendidas: ruido o muletillas ("mmm", "gracias",
  "ok") tomados como orden; el micrófono recogiendo la propia voz de ELIX (eco); y el cerebro ofreciendo ayuda por su cuenta.
  Ahora esos casos se ignoran (aparece un aviso gris en pantalla) y el cerebro tiene prohibido ofrecer ayuda sin que se la pidan.

## Barra de volumen y cambio de salida de audio (v1.0.31)
- Al subir, bajar, fijar o silenciar el volumen general, ahora aparece la barra de volumen de Windows (con el nivel real).
  El volumen por app (Spotify, Chrome…) no la muestra: Windows no tiene barra para eso.
- Cambio de salida con tres destinos: "parlantes de la laptop", "auriculares/audífonos" (con cable) y "audífonos inalámbricos / Corsair".
  Windows solo lista los dispositivos conectados y encendidos: si uno no aparece, ELIX dice cuáles ve. Sigue pidiendo confirmación por voz.

## Más rápido y atajos aprendidos (v1.0.33)
- Arreglado: pedías un cambio (p. ej. «pasa el sonido a los altavoces»), Radex preguntaba «¿confirmas?», decías «sí» y no hacía nada.
  Causa: el tope de 10 s se contaba desde la orden y, con el cerebro lento, se vencía antes de que pudieras responder.
  Ahora la pregunta de confirmación se dice directo (sin otra llamada al cerebro), tienes 8 s desde que termina de preguntar (tope 20 s desde la orden),
  y un «sí/no» muy corto ya no lo descartan los filtros anti-ruido.
- Atajos aprendidos: cuando le das una orden NUEVA y la hace bien (comprobada), Radex pregunta «¿Quieres que aprenda esta orden?».
  Si dices «sí», la guarda en `atajos.json` (carpeta de datos de la app, junto a `memoria.json`) y la próxima vez la ejecuta al instante, sin llamar al cerebro y sin gastar tokens.
  Si dices «no», la marca para no volver a preguntarte. Las acciones con confirmación siguen pidiéndola siempre.
  Solo aprende acciones de audio, volumen, multimedia, abrir apps/carpetas y ventanas. Si un atajo falla 2 veces seguidas, se olvida solo.
- Historial más corto (4 turnos) y menos espera de silencio (0,55 s): menos tokens y respuesta más rápida.

