'use strict';
// Herramientas de diagnóstico: comprueban que el registro, el puente PowerShell, el audio de Windows
// (lectura y control) y la confirmación por voz funcionan. No cambian nada en el PC.
module.exports = function registerDiagnostic(registry, bridge) {
  const SUENA = 2;

  registry.register({
    name: 'tools_diagnostic',
    risk: 'safe',
    description: 'Comprueba el estado de las herramientas avanzadas del PC (PowerShell, compilación C#, lectura y control del audio de Windows, herramientas registradas). Úsala solo si el usuario pide un diagnóstico o revisar si las herramientas avanzadas funcionan. Al responder por voz, menciona TODOS los datos del resultado: cuántas herramientas y cuáles, versión de PowerShell y tiempos, dispositivos de audio con su volumen, qué apps tienen audio y si el cambio de dispositivo está disponible.',
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

      // Lectura del audio (solo lectura)
      let aud;
      try {
        const ta = Date.now();
        const ar = await bridge.request('audio.leer', { direccion: 'salida' }, { module: 'audio', timeout: 30000 });
        const d = JSON.parse(ar.json);
        aud = { ok: true, ms: Date.now() - ta, devs: d.dispositivos || [], apps: d.apps || [] };
      } catch (e) { aud = { ok: false, error: String((e && e.message) || e).split('\n')[0].slice(0, 160) }; }

      // Control del audio: solo comprueba que compila y que Windows ofrece el cambio de dispositivo (no cambia nada)
      let ctl;
      try {
        const tc = Date.now();
        const cr = await bridge.request('audio.control_ok', {}, { module: 'audio-control', timeout: 30000 });
        ctl = { ok: true, ms: Date.now() - tc, politica: String((cr && cr.politica) || '') };
      } catch (e) { ctl = { ok: false, error: String((e && e.message) || e).split('\n')[0].slice(0, 160) }; }

      const vol = (x) => `${x.volumen == null ? '?' : x.volumen + '%'}${x.silenciado ? ', silenciado' : ''}`;
      const lang = ping.mode === 'FullLanguage';
      const partes = [
        `${names.length} herramientas registradas: ${names.join(', ')}`,
        `PowerShell ${ping.psVersion} (${ping.bits64 ? '64' : '32'} bits), modo ${ping.mode}, respuesta en ${ms} ms`,
        chk.addType ? `compilación C# correcta en ${chk.ms} ms` : `la compilación C# FALLÓ${chk.error ? ': ' + String(chk.error).slice(0, 160) : ''}`,
      ];
      if (aud.ok) {
        const def = aud.devs.find((x) => x.predeterminado);
        const otros = aud.devs.filter((x) => x !== def);
        partes.push(`lectura de audio correcta en ${aud.ms} ms: ${aud.devs.length} dispositivo(s) de salida`
          + (def ? `, el predeterminado es «${def.nombre}» con volumen ${vol(def)}` : '')
          + (otros.length ? `; otros: ${otros.map((x) => `«${x.nombre}» (${vol(x)})`).join(', ')}` : ''));
        const fa = (a) => `${a.nombre} (${a.volumen == null ? '?' : a.volumen + '%'}${a.silenciada ? ', silenciada' : ''}${a.pico >= SUENA && !a.silenciada ? ', sonando' : ''})`;
        partes.push(aud.apps.length ? `${aud.apps.length} app(s) con sesión de audio: ${aud.apps.map(fa).join(', ')}` : 'ninguna app tiene sesión de audio ahora mismo');
      } else partes.push(`la lectura del audio FALLÓ: ${aud.error}`);
      if (ctl.ok) partes.push(`control de audio compilado en ${ctl.ms} ms; cambio de dispositivo de salida ${ctl.politica === 'ok' ? 'disponible' : 'NO disponible (' + ctl.politica.slice(0, 120) + ')'}`);
      else partes.push(`el control de audio FALLÓ: ${ctl.error}`);

      const ok = lang && !!chk.addType && aud.ok && ctl.ok;
      return { ok, verified: true, mensaje: partes.join('; ') + '.' + (ok ? '' : ' El audio avanzado necesita modo FullLanguage, compilación C# y acceso al audio de Windows.') };
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
