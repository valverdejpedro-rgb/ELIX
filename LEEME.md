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

## Probar en local
npm install && npm start
