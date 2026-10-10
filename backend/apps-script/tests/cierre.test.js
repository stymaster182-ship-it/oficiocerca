/* Pruebas OFFLINE del cierre pre-piloto (node backend/apps-script/tests/cierre.test.js).
 * Reutiliza el entorno simulado de v17.test.js (mismo Code.gs real, sin red, sin Wompi, sin dinero).
 * Cubre: ayuda antes de cancelar/rechazar (cliente y profesional), WhatsApp contextual sin datos privados, confirmación
 * expresa, estado como fuente de verdad en cada pantalla, idempotencia (doble clic / recargas / enlaces antiguos)
 * y mapa real de correos de un servicio completo. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const fuente = fs.readFileSync(path.join(__dirname, 'v17.test.js'), 'utf8');
const harness = fuente.slice(fuente.indexOf('function crearEntorno()'), fuente.indexOf('const resultados = [];'));
const H_ = new Function('require', '__dirname', 'fs', 'path', 'vm', 'crypto', 'assert', harness.replace(/^let /mg, 'var ') + '\nreturn { crearEntorno, nuevoPro, postWeb, solicitudWeb, tokenDe, correosA, ultimoToken, accionWeb, pagina, tick, sol, setSol, hastaAsignado, conAcuerdo, H };')(require, __dirname, fs, path, require('vm'), require('crypto'), assert);
const { crearEntorno, nuevoPro, postWeb, solicitudWeb, correosA, ultimoToken, accionWeb, pagina, tick, sol, setSol, hastaAsignado, conAcuerdo, H } = H_;

const resultados = [];
function caso(nombre, fn) { try { fn(); resultados.push(['OK', nombre]); } catch (e) { resultados.push(['ERROR', nombre + ' → ' + (e && e.stack || e)]); } }
const SALIDA = process.env.OC_HTML_DIR; // si se define, guarda el HTML de cada pantalla para la prueba visual
function guardar(nombre, r) { if (SALIDA) { fs.mkdirSync(SALIDA, { recursive: true }); fs.writeFileSync(path.join(SALIDA, nombre + '.json'), JSON.stringify(r)); } return r; }
const ya = r => !!(r && r.ok && /\b[Yy]a\b/.test(r.msg || ''));
const n = (re, s) => (s.match(re) || []).length;
const botones = html => (html.match(/enviar\(\{a:\\?'([a-z_]+)'(?:,d:\\?'([a-z]+)')?/g) || []).map(x => x.replace(/\\/g, ''));
function sinPrivado(html, F, E) {
  const s = sol(E, F.oc), datos = (html.match(/data-(oc|rol|servicio|estado|contexto)="[^"]*"/g) || []).join(' ');
  assert.ok(!/[a-f0-9]{64}/.test(datos) && !datos.includes(s['Email']) && !datos.includes(String(s['WhatsApp']).replace(/\D/g, '')) && !/https?:/.test(datos), 'datos del bloque sin token/URL/correo/teléfono: ' + datos);
}

/* ---------- 1. Ayuda antes de cancelar: cliente buscando ---------- */
caso('Cliente (buscando): ayuda antes de cancelar visible, sin confirm() nativo, un solo bloque, antes de «Otras opciones»', () => {
  const E = crearEntorno(); nuevoPro(E);
  const r = solicitudWeb(E, 'PRUEBA Ana'); tick(E);
  const email = sol(E, r.code)['Email'], tS = ultimoToken(E, email, 'seguimiento');
  const pg = guardar('cli-01-buscando', pagina(E, tS)).cuerpo;
  assert.strictEqual(n(/class="antes-cancelar"/g, pg), 1, 'un bloque');
  assert.ok(/¿Tienes una duda o algún problema antes de cancelar\?/.test(pg) && /Podemos ayudarte antes de cerrar esta solicitud\./.test(pg));
  assert.ok(/HABLAR CON UN ASESOR/.test(pg) && /CANCELAR DE TODAS FORMAS/.test(pg) && /¿Quieres cancelar de todas formas\?/.test(pg));
  assert.ok(!/confirm\(/.test(pg), 'sin confirm() del navegador');
  assert.ok(pg.indexOf('antes-cancelar') < pg.indexOf('Otras opciones'), 'en el contexto del servicio, antes de «Otras opciones»');
  assert.ok(/data-oc="OC-\d{4}" data-rol="Cliente" data-servicio="Electricidad" data-estado="Buscando un profesional compatible"/.test(pg));
  sinPrivado(pg, { oc: r.code }, E);
  assert.ok(!/wa\.me/.test(pg), 'el número lo pone la web');
  // Pulsar «Hablar con un asesor» no envía nada al servidor (es un enlace); la solicitud sigue viva
  assert.strictEqual(sol(E, r.code)['Estado'] === 'Cancelada', false);
  // Confirmación expresa → cancela; segunda vez → idempotente; la página refleja el estado
  const c1 = accionWeb(E, tS, { a: 'cancelar' }); assert.ok(c1.ok && sol(E, r.code)['Estado'] === 'Cancelada');
  const c2 = accionWeb(E, tS, { a: 'cancelar' }); assert.ok(c2.ok && /ya estaba cancelada/.test(c2.msg));
  const pc = guardar('cli-02-cancelada', pagina(E, tS)).cuerpo;
  assert.ok(/está cancelada/.test(pc) && !/antes-cancelar/.test(pc) && !/a:'cancelar'/.test(pc), 'sin acciones de cancelar tras cancelar');
  assert.strictEqual(E.ctx.tabla_('Ofertas').todas().filter(o => o['Código OC'] === r.code && o['Estado'] === 'Enviada').length, 0, 'oferta cerrada');
});

/* ---------- 2. Esperando decisión del cliente: un único bloque (antes había dos botones de cancelar) ---------- */
caso('Cliente (necesitamos tu decisión): un único cancelar con ayuda; «Cancelar» por la decisión funciona y es idempotente', () => {
  const E = crearEntorno(); const pro = nuevoPro(E);
  const r = postWeb(E, { tipo: 'solicitud', tipoSolicitante: 'Particular', nombre: 'PRUEBA Bea', whatsapp: '611222333', email: 'bea@example.com', zona: 'Centro', oficio: 'electricidad',
    descripcion: 'Enchufe', plazo: 'HOY_MANANA', consentOperativo: 'si', contactoPreferido: 'WhatsApp' });
  tick(E);
  const pEmail = E.ctx.profesional_(pro)['Email'], tO = ultimoToken(E, pEmail, 'gestion');
  const f = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  assert.ok(accionWeb(E, tO, { a: 'mas_adelante', fecha: f }).ok); tick(E);
  assert.strictEqual(sol(E, r.code)['Estado'], 'Esperando decisión cliente');
  const tS = ultimoToken(E, 'bea@example.com', 'seguimiento');
  const pg = guardar('cli-03-decision', pagina(E, tS)).cuerpo;
  assert.strictEqual(n(/class="antes-cancelar"/g, pg), 1, 'un solo bloque de cancelar');
  assert.strictEqual(botones(pg).filter(b => /cancelar/.test(b)).length, 1, 'una sola acción de cancelar: ' + botones(pg));
  assert.ok(/a:'respaldo',d:'continuar'/.test(pg.replace(/\\/g, '')) && /a:'respaldo',d:'seguir'/.test(pg.replace(/\\/g, '')));
  assert.ok(accionWeb(E, tS, { a: 'respaldo', d: 'cancelar' }).ok && sol(E, r.code)['Estado'] === 'Cancelada');
  const otra = accionWeb(E, tS, { a: 'respaldo', d: 'cancelar' }); assert.ok(!otra.ok || ya(otra), 'idempotente: ' + otra.msg);
});

/* ---------- 3. Profesional: ayuda antes de rechazar la oportunidad ---------- */
caso('Profesional (oportunidad): ayuda antes de rechazar; rechazar sigue funcionando; enlace de un solo uso', () => {
  const E = crearEntorno(); const pro = nuevoPro(E), pro2 = nuevoPro(E, 'PRUEBA Segundo');
  const r = solicitudWeb(E, 'PRUEBA Carla'); tick(E);
  const pEmail = E.ctx.profesional_(pro)['Email'], tO = ultimoToken(E, pEmail, 'gestion') || ultimoToken(E, E.ctx.profesional_(pro2)['Email'], 'gestion');
  const pg = guardar('pro-01-oportunidad', pagina(E, tO)).cuerpo;
  assert.strictEqual(n(/class="antes-cancelar"/g, pg), 1);
  assert.ok(/data-rol="Profesional"/.test(pg) && /data-contexto="antes de rechazar la oportunidad"/.test(pg) && /data-estado="Oportunidad pendiente de tu respuesta"/.test(pg));
  assert.ok(/¿Tienes una duda o algún problema antes de rechazarla\?/.test(pg) && /SÍ, RECHAZAR DE TODAS FORMAS/.test(pg) && /PUEDO ATENDERLO/.test(pg));
  sinPrivado(pg, { oc: r.code }, E);
  assert.ok(!/WhatsApp del cliente|cli\d+@example\.com/.test(pg), 'sin datos del cliente antes de aceptar');
  const x = accionWeb(E, tO, { a: 'no', nota: 'Agenda llena' }); assert.ok(x.ok, x.msg);
  const y = accionWeb(E, tO, { a: 'si', disp: 'MANANA' }); assert.ok(ya(y), 'un solo uso');
  assert.ok(/Respuesta ya registrada/.test(pagina(E, tO).titulo));
});

/* ---------- 4. Recorrido completo: cada pantalla con sus acciones válidas (estado = fuente de verdad) ---------- */
let E4, F4;
caso('Recorrido completo cliente/profesional: acciones derivadas del estado en cada paso', () => {
  E4 = crearEntorno(); const E = E4; const F = F4 = hastaAsignado(E);
  const paso = (nom, quien, t) => { const r = guardar(nom, pagina(E, t)); return { c: r.cuerpo, b: botones(r.cuerpo).join(' ') }; };
  // Contacto habilitado
  let c = paso('cli-04-asignado', 'c', F.tS), p = paso('pro-02-asignado', 'p', F.tG);
  assert.ok(!/cancelar/.test(c.b) && !/antes-cancelar/.test(c.c), 'el cliente ya no cancela: usa «Hay un problema»');
  assert.ok(/incidencia/.test(c.b) && /WhatsApp del profesional/.test(c.c));
  assert.ok(/acuerdo/.test(p.b) && !/finalizado/.test(p.b) && /WhatsApp del cliente/.test(p.c));
  // Acuerdo (doble clic = una sola versión)
  assert.ok(accionWeb(E, F.tG, { a: 'acuerdo', mo: 800, mat: 100, dn: 5, du: 'dias' }).ok);
  assert.ok(ya(accionWeb(E, F.tG, { a: 'acuerdo', mo: 800, mat: 100, dn: 5, du: 'dias' })), 'doble acuerdo no duplica');
  assert.strictEqual(E.ctx.tabla_('Presupuestos').todas().filter(x => x['Código OC'] === F.oc).length, 1);
  c = paso('cli-05-en-proceso', 'c', F.tS); p = paso('pro-03-en-proceso', 'p', F.tG);
  assert.ok(/Acuerdo registrado por el profesional/.test(c.c) && /termino/.test(c.b) && !/fin_si/.test(c.b));
  assert.ok(/finalizado/.test(p.b) && /plazo/.test(p.b) && !/a:'acuerdo'/.test(p.c.replace(/\\/g, '')), 'tras el acuerdo, sin formulario de acuerdo');
  // Vencimiento → el profesional amplía el plazo
  setSol(E, F.oc, { 'Fecha estimada fin': new Date(Date.now() - 1000) }); E.props.PROX_SEGUIMIENTO = String(Date.now() - 1); tick(E);
  c = paso('cli-06-vencido', 'c', F.tS); assert.ok(/Llegó la fecha estimada/.test(c.c) && /sigue/.test(c.b));
  assert.ok(accionWeb(E, F.tG, { a: 'plazo', dn: 2, du: 'dias' }).ok);
  assert.ok(!sol(E, F.oc)['Acción pendiente de'], 'avisos detenidos tras actualizar');
  // Cierre por el profesional (doble clic idempotente)
  assert.ok(accionWeb(E, F.tG, { a: 'finalizado', mo: 900, adicionales: 'si', motivo: 'Un punto de luz más', mat: '' }).ok);
  assert.ok(ya(accionWeb(E, F.tG, { a: 'finalizado', mo: 900, adicionales: 'si', motivo: 'Un punto de luz más', mat: '' })));
  c = paso('cli-07-confirmar', 'c', F.tS); p = paso('pro-04-esperando-cliente', 'p', F.tG);
  assert.ok(/fin_si/.test(c.b) && /fin_aun_no/.test(c.b) && !/termino/.test(c.b), 'cliente: confirmar / todavía no');
  assert.ok(!/finalizado/.test(p.b) && /Falta la confirmación del cliente/.test(p.c));
  // Confirmación del cliente (doble clic) → cerrado, comisión una sola vez y NO habilitada
  assert.ok(accionWeb(E, F.tS, { a: 'fin_si' }).ok); assert.ok(ya(accionWeb(E, F.tS, { a: 'fin_si' })));
  assert.strictEqual(sol(E, F.oc)['Estado'], 'Cerrado');
  const coms = E.ctx.tabla_('Comisiones').todas().filter(x => x['Código OC'] === F.oc);
  assert.strictEqual(coms.length, 1); assert.strictEqual(coms[0]['Estado'], 'NO_HABILITADA'); assert.strictEqual(Number(coms[0]['Importe comisión (€)']), 90);
  c = paso('cli-08-cerrado', 'c', F.tS); p = paso('pro-05-cerrado', 'p', F.tG);
  assert.ok(/valorar/.test(c.b) && !/fin_si|termino|incidencia|cancelar/.test(c.b), 'cerrado: solo valorar (y pedir otro servicio)');
  assert.ok(!/finalizado|plazo|acuerdo|pagar/.test(p.b), 'profesional: nada que hacer');
  // Valoración (doble) y recarga
  assert.ok(accionWeb(E, F.tS, { a: 'valorar', estrellas: 5, comentario: 'Bien' }).ok); assert.ok(ya(accionWeb(E, F.tS, { a: 'valorar', estrellas: 4 })));
  assert.strictEqual(E.ctx.tabla_('Valoraciones').todas().filter(x => x['Código OC'] === F.oc).length, 1);
  c = paso('cli-09-valorado', 'c', F.tS); assert.ok(/ya recibimos tu valoración/.test(c.c) && !/valorar/.test(c.b));
  // Acciones fuera de estado: rechazadas sin efectos
  assert.ok(!accionWeb(E, F.tS, { a: 'cancelar' }).ok, 'no se cancela un servicio cerrado');
  assert.ok(!accionWeb(E, F.tG, { a: 'plazo', dn: 3, du: 'dias' }).ok);
  assert.ok(!accionWeb(E, F.tG, { a: 'acuerdo', mo: 1, dn: 1, du: 'dias' }).ok);
  tick(E); tick(E);
  assert.strictEqual(sol(E, F.oc)['Estado'], 'Cerrado');
});

caso('Correos del recorrido: una sola vez por evento, cortos, un botón al lugar donde se actúa', () => {
  const E = E4, F = F4, ms = E.enviados;
  const asuntos = ms.map(m => m.to + ' | ' + m.subject);
  assert.strictEqual(new Set(asuntos).size, asuntos.length, 'sin duplicados: ' + asuntos.join('\n'));
  ms.filter(m => m.to === F.email || m.to === F.pEmail).forEach(m => {
    const urls = (m.htmlBody.match(/href="https:\/\/oficiocerca\.pages\.dev\/(seguimiento|gestion)\/#[a-f0-9]{64}"/g) || []);
    assert.ok(urls.length <= 1, 'un botón: ' + m.subject);
    assert.ok(m.body.length < 1200, 'corto: ' + m.subject + ' ' + m.body.length);
  });
  assert.ok(!ms.some(m => /seguimos buscando/i.test(m.subject + m.body)));
  if (process.env.OC_MAPA) console.log(ms.map(m => (m.to === F.email ? 'CLIENTE' : m.to === F.pEmail ? 'PROFESIONAL' : m.to) + ' · ' + m.subject).join('\n'));
});

/* ---------- 5. Incidencia: frena cierre, comisión y reseña; no bloquea al profesional ---------- */
caso('Incidencia: pasa a revisión, detiene cierre/comisión/reseña, soporte avisado, sin bloqueo automático; doble envío no duplica', () => {
  const E = crearEntorno(), F = conAcuerdo(E, 500);
  const t = 'El profesional no vino';
  assert.ok(accionWeb(E, F.tS, { a: 'incidencia', categoria: 'Retraso', texto: t }).ok);
  assert.ok(ya(accionWeb(E, F.tS, { a: 'incidencia', categoria: 'Retraso', texto: t })), 'doble incidencia');
  assert.strictEqual(sol(E, F.oc)['Estado'], 'En revisión');
  tick(E);
  assert.strictEqual(E.enviados.filter(m => /Nueva incidencia/.test(m.subject)).length, 1, 'un aviso a soporte');
  const pc = guardar('cli-10-revision', pagina(E, F.tS)).cuerpo, pp = guardar('pro-06-revision', pagina(E, F.tG)).cuerpo;
  assert.ok(/data-wa-soporte/.test(pc) && /data-wa-soporte/.test(pp));
  assert.ok(!/fin_si|termino|valorar/.test(botones(pc).join(' ')) && !/finalizado|plazo/.test(botones(pp).join(' ')), 'acciones detenidas');
  assert.ok(!accionWeb(E, F.tG, { a: 'finalizado', mo: 500 }).ok, 'cierre detenido');
  assert.ok(!accionWeb(E, F.tS, { a: 'valorar', estrellas: 1 }).ok, 'reseña detenida');
  assert.strictEqual(E.ctx.profesional_(F.pro)['Estado'], 'Activo', 'no se bloquea al profesional');
  const inc = E.ctx.tabla_('Incidencias').todas().filter(i => i['Código OC'] === F.oc)[0];
  assert.ok(/Resuelta/.test(E.ctx.resolverIncidencia_(inc['ID'], 'OTRO', 'admin') ? 'Resuelta' : ''));
  assert.strictEqual(sol(E, F.oc)['Estado'], 'Trabajo en proceso', 'resolución manual reanuda');
  assert.strictEqual(E.ctx.tabla_('Incidencias').buscar('ID', inc['ID'])['Estado'], 'Resuelta');
});

/* ---------- 6. Sin profesional · volver a buscar · URLs inválidas · acceso cruzado ---------- */
caso('Sin profesional: «Volver a buscar» y cancelar con ayuda; enlaces inválidos y cruzados rechazados', () => {
  const E = crearEntorno();
  const r = solicitudWeb(E, 'PRUEBA Dani'); tick(E);
  setSol(E, r.code, { 'Estado': 'Sin profesional disponible' });
  const tS = ultimoToken(E, sol(E, r.code)['Email'], 'seguimiento');
  const pg = guardar('cli-11-sin-profesional', pagina(E, tS)).cuerpo;
  assert.ok(/volver_a_buscar/.test(botones(pg).join(' ')) && n(/class="antes-cancelar"/g, pg) === 1);
  assert.ok(/Enlace no válido/.test(pagina(E, 'a'.repeat(64)).titulo));
  assert.ok(!accionWeb(E, 'b'.repeat(64), { a: 'cancelar' }).ok);
  assert.ok(!accionWeb(E, tS, { a: 'abrir_servicio', oc: 'OC-9999' }).ok, 'no abre servicios ajenos');
});

/* ---------- 7. La web: WhatsApp contextual (sin token/URL privada/correo/teléfono) ---------- */
caso('Web: el enlace de WhatsApp del bloque lleva OC, rol, servicio, estado y motivo; nada privado', () => {
  const web = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'seguimiento', 'index.html'), 'utf8');
  const g = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'gestion', 'index.html'), 'utf8');
  [web, g].forEach(w => {
    assert.ok(/function waCancelar\(\)/.test(w) && /waCancelar\(\);/.test(w));
    assert.ok(/necesito ayuda antes de cancelar la solicitud '\+oc\+'\. Soy cliente\./.test(w) && /Soy profesional\./.test(w));
    assert.ok(/' Servicio: '\+\(d\.servicio\|\|''\)\+'\. Estado actual: '\+\(d\.estado\|\|''\)/.test(w) && /' Motivo: '\+sel\.value/.test(w));
    const fn = w.slice(w.indexOf('function waCancelar'), w.indexOf('// Servicio cancelado'));
    assert.ok(!/location|T\b|token|Email|WhatsApp del/.test(fn.replace(/WA\b/g, '')), 'sin token ni URL privada en el mensaje');
  });
});

/* ---------- 8. Limpieza de la prueba OC-0001 y reinicio seguro de SEQ_OC ---------- */
caso('Limpieza: borra solo la prueba indicada, reinicia SEQ_OC solo si no queda ninguna OC, no toca otros contadores', () => {
  const E = crearEntorno();
  Object.values(E.sheets).forEach(sh => { sh.deleteRow = function (r) { this.rows.splice(r - 1, 1); }; });
  E.ctx.actualizarPanel = () => {};
  const r = solicitudWeb(E, 'PRUEBA Propietario'); tick(E);
  accionWeb(E, ultimoToken(E, sol(E, r.code)['Email'], 'seguimiento'), { a: 'cancelar' });
  E.props.SEQ_PRO = '0'; E.props.SEQ_INC = '0';
  // Con otra solicitud viva NO se reinicia
  const r2 = solicitudWeb(E, 'PRUEBA Otra');
  let inf = E.ctx.limpiarSolicitudesDePrueba_([r.code], []).join('\n');
  assert.ok(/SEQ_OC NO reiniciado/.test(inf) && E.props.SEQ_OC === '2', inf);
  assert.ok(!E.ctx.tabla_('Solicitudes').todas().some(s => s['Código'] === r.code) && !!sol(E, r2.code));
  // Sin ninguna OC → reinicio a 0 y la siguiente solicitud es OC-0001
  inf = E.ctx.limpiarSolicitudesDePrueba_([r2.code], []).join('\n');
  assert.ok(/SEQ_OC: 2 → 0/.test(inf), inf);
  ['Solicitudes', 'Ofertas', 'Historial envíos', 'Registro', 'Tokens'].forEach(n => {
    const c = n === 'Solicitudes' ? 'Código' : 'Código OC';
    assert.strictEqual(E.ctx.tabla_(n).todas().filter(x => /^OC-/.test(String(x[c]))).length, 0, n);
  });
  assert.ok(E.props.SEQ_PRO === '0' && E.props.SEQ_INC === '0', 'otros contadores intactos');
  assert.strictEqual(solicitudWeb(E, 'PRUEBA Nueva').code, 'OC-0001');
});

resultados.forEach(r => console.log(r[0] + ' · ' + r[1]));
const err = resultados.filter(r => r[0] !== 'OK').length;
console.log('\n' + (resultados.length - err) + '/' + resultados.length + ' casos OK' + (err ? ' · ' + err + ' CON ERROR' : ' · TODO OK'));
process.exit(err ? 1 : 0);
