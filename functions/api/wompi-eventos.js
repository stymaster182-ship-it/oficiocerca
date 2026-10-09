/**
 * OficioCerca · Relé de la URL de eventos de Wompi (Cloudflare Pages Function: POST /api/wompi-eventos).
 *
 * Por qué existe: Apps Script responde a un POST con una redirección 302, y Wompi exige HTTP 200 para dar
 * el evento por entregado (si no, reintenta). Este relé reenvía el cuerpo SIN TOCARLO al backend
 * (que verifica la firma con el secreto de eventos, que aquí NO está), sigue la redirección y devuelve:
 *   200 → backend procesó el evento (o lo reconoce como duplicado / ignorado)
 *   401 → firma o ambiente inválidos (no viene de Wompi)
 *   502 → el backend no respondió correctamente (Wompi reintentará; el backend es idempotente)
 * No guarda nada, no registra el contenido y no contiene secretos.
 */
const BACKEND = 'https://script.google.com/macros/s/AKfycbyjOjHiDWHdLwXx23eMkHZi7z2PYbTRiuqYYQvfe7HGRdnPfWqNO9MlhB-pl0_BrCHZ/exec';
const MAX_BYTES = 64 * 1024;

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request }) {
  const body = await request.text();
  if (!body || body.length > MAX_BYTES) return json({ ok: false, error: 'tamaño' }, 413);
  let ev;
  try { ev = JSON.parse(body); } catch (e) { return json({ ok: false, error: 'json' }, 400); }
  if (!ev || !ev.event || !ev.signature || !ev.data) return json({ ok: false, error: 'formato' }, 400);
  let res, out;
  try {
    res = await fetch(BACKEND, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, redirect: 'follow' });
    out = JSON.parse(await res.text());
  } catch (e) {
    return json({ ok: false, error: 'backend' }, 502);
  }
  if (out && out.ok) return json({ ok: true }, 200);
  if (out && (out.error === 'firma' || out.error === 'ambiente')) return json({ ok: false, error: out.error }, 401);
  return json({ ok: false, error: 'backend' }, 502);
}

export function onRequest() {
  return json({ ok: false, error: 'método' }, 405);
}
