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
      const lang = ping.mode === 'FullLanguage';
      const partes = [
        `${names.length} herramientas registradas`,
        `PowerShell ${ping.psVersion} (${ping.bits64 ? '64' : '32'} bits), modo ${ping.mode}, respuesta en ${ms} ms`,
        chk.addType ? `compilación C# correcta en ${chk.ms} ms` : `la compilación C# FALLÓ${chk.error ? ': ' + String(chk.error).slice(0, 160) : ''}`,
      ];
      const ok = lang && !!chk.addType;
      return { ok, verified: true, mensaje: partes.join('; ') + '.' + (ok ? '' : ' El audio avanzado necesita modo FullLanguage y compilación C#.'), detalle: 'Herramientas: ' + names.join(', ') };
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
