'use strict';
// Herramientas de diagnóstico de la etapa 1: comprueban que el registro, el puente PowerShell
// y la confirmación por voz funcionan. No cambian nada en el PC.
module.exports = function registerDiagnostic(registry, bridge) {
  registry.register({
    name: 'tools_diagnostic',
    risk: 'safe',
    description: 'Comprueba el estado de las herramientas avanzadas del PC (PowerShell, compilación C#, herramientas registradas). Úsala solo si el usuario pide un diagnóstico o revisar si las herramientas avanzadas funcionan.',
    schema: { properties: {}, required: [] },
    async run() {
      const names = registry.catalog().map((t) => t.name);
      const t0 = Date.now();
      let ping;
      try { ping = await bridge.request('ping'); }
      catch (e) { return { ok: false, verified: true, mensaje: `PowerShell no respondió: ${e.message}. Hay ${names.length} herramientas registradas.` }; }
      const ms = Date.now() - t0;
      let chk = null;
      try { chk = await bridge.request('selfcheck', {}, { timeout: 30000 }); } catch (e) { chk = { addType: false, error: e.message }; }
      // Etapa 2: lectura real del audio de Windows (solo lectura)
      let aud = null;
      try {
        const ta = Date.now();
        const ar = await bridge.request('audio.leer', { direccion: 'salida' }, { module: 'audio', timeout: 30000 });
        const d = JSON.parse(ar.json);
        aud = { ok: true, ms: Date.now() - ta, devs: d.dispositivos.length, apps: d.apps.length, def: (d.dispositivos.find((x) => x.predeterminado) || {}).nombre || '' };
      } catch (e) { aud = { ok: false, error: String((e && e.message) || e).split('\n')[0].slice(0, 160) }; }
      const lang = ping.mode === 'FullLanguage';
      const partes = [
        `${names.length} herramientas registradas`,
        `PowerShell ${ping.psVersion} (${ping.bits64 ? '64' : '32'} bits), modo ${ping.mode}, respuesta en ${ms} ms`,
        chk.addType ? `compilación C# correcta en ${chk.ms} ms` : `la compilación C# FALLÓ${chk.error ? ': ' + String(chk.error).slice(0, 160) : ''}`,
        aud.ok ? `audio de Windows: ${aud.devs} dispositivo(s) de salida${aud.def ? ' (predeterminado: ' + aud.def + ')' : ''} y ${aud.apps} app(s) con sesión de audio, leído en ${aud.ms} ms` : `la lectura del audio FALLÓ: ${aud.error}`,
      ];
      const ok = lang && !!chk.addType && aud.ok;
      return { ok, verified: true, mensaje: partes.join('; ') + '.' + (ok ? '' : ' El audio avanzado necesita modo FullLanguage, compilación C# y acceso al audio de Windows.'), detalle: 'Herramientas: ' + names.join(', ') };
    },
  });

  registry.register({
    name: 'tools_test_confirmation',
    risk: 'confirm',
    description: 'SOLO PARA PRUEBAS: úsala únicamente si el usuario pide probar la confirmación por voz. No cambia nada en el PC.',
    schema: { properties: {}, required: [] },
    async plan() { return { resolved: {}, resumen: 'Esto es solo una prueba de confirmación; no se cambiará nada en el PC' }; },
    async run() { return { ok: true, verified: true, mensaje: 'Confirmación recibida correctamente. No se cambió nada en el PC.' }; },
  });
};
