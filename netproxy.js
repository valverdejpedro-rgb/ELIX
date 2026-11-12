// Llamadas de red hechas desde el proceso principal (sin CORS) hacia proveedores de IA conocidos.
// La página nunca llama a estos servidores directamente en la versión de escritorio.
const HOSTS = new Set([
  'api.groq.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
  'www.googleapis.com',
]);
const defaultAllow = (u) => u.protocol === 'https:' && HOSTS.has(u.hostname);
const HEADER_OK = /^(authorization|content-type|x-goog-api-key)$/i;

// req: { url, method, headers, body (texto), form: { fields, file: { bytes, type, name } }, timeout }
async function proxyFetch(req, allow = defaultAllow) {
  let u;
  try { u = new URL(String(req && req.url)); } catch { return { status: 0, body: 'URL no válida.' }; }
  if (!allow(u)) return { status: 0, body: 'Servidor no permitido.' };

  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) if (HEADER_OK.test(k)) headers[k] = String(v);

  let body;
  if (req.form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(req.form.fields || {})) fd.append(k, String(v));
    const f = req.form.file;
    if (f) fd.append('file', new Blob([Buffer.from(f.bytes)], { type: f.type || 'application/octet-stream' }), f.name || 'file');
    body = fd;
    delete headers['content-type']; delete headers['Content-Type']; // lo pone FormData con su boundary
  } else if (req.body != null) {
    body = String(req.body);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(1000, Math.min(60000, +req.timeout || 25000)));
  try {
    const r = await fetch(u.href, { method: req.method || 'POST', headers, body, signal: ctl.signal });
    return { status: r.status, body: await r.text() };
  } catch (err) {
    return { status: 0, aborted: !!(err && err.name === 'AbortError'), body: String((err && err.message) || err).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

module.exports = { proxyFetch };
