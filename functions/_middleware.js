// Dominio oficial de OficioCerca: https://oficiocercaya.com (la marca sigue siendo «OficioCerca»).
// - oficiocerca.pages.dev (enlaces antiguos) → 301 a oficiocercaya.com conservando ruta y parámetros.
// - www.oficiocercaya.com → 301 a oficiocercaya.com.
// Solo GET/HEAD: los POST (p. ej. /api/wompi-eventos) y las vistas previas de rama (<rama>.oficiocerca.pages.dev) no se tocan.
// El «#» de los enlaces privados de seguimiento/gestión nunca llega al servidor: el navegador lo conserva al seguir la redirección.
const CANONICO = 'oficiocercaya.com';
const REDIRIGIR = new Set(['oficiocerca.pages.dev', 'www.oficiocercaya.com']);

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  if (REDIRIGIR.has(url.hostname) && (request.method === 'GET' || request.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
    url.hostname = CANONICO;
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
