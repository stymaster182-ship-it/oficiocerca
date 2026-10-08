/* ============================================================ WOMPI · SOLO SANDBOX (modo de pruebas, sin dinero real)
 *
 * Aislamiento (nada de esto toca producción):
 *  - Solo funciona si Configuración → WOMPI_SANDBOX_ENABLED = TRUE (por defecto FALSE).
 *  - Solo actúa sobre solicitudes Y profesionales de PRUEBA (nombre con «PRUEBA»). Clientes y profesionales reales: sin cambios.
 *  - Solo acepta credenciales de PRUEBAS (pub_test_ / test_integrity_ / test_events_). Si detecta una de producción se detiene.
 *  - No usa COMMISSION_COLLECTION_ENABLED ni la pestaña «Comisiones» (usa «Comisiones Sandbox», «Pagos Sandbox», «Eventos Wompi»).
 *  - Los secretos NO están en el código ni en la hoja: Propiedades del script (los pega Steven en el editor de Apps Script):
 *      WOMPI_TEST_PUBLIC_KEY · WOMPI_TEST_INTEGRITY_SECRET · WOMPI_TEST_EVENTS_SECRET
 *  - La conversión EUR→COP usa TEST_EXCHANGE_RATE: TASA FICTICIA DE PRUEBA, nunca una tasa real.
 *
 * Flujo: presupuesto aceptado → NOT_DUE · cliente confirma fin («Sí, está terminado») → DUE + correo [PRUEBA / SANDBOX]
 *        con enlace de pago → checkout Wompi SANDBOX (firma de integridad generada aquí, en el servidor)
 *        → evento transaction.updated verificado (checksum SHA-256) → PAID / PAYMENT_PENDING / PAYMENT_FAILED / MANUAL_REVIEW.
 *        La redirección del navegador NUNCA cambia estados: solo el evento verificado.
 */

var WOMPI_SBX = {
  CHECKOUT_URL: 'https://checkout.wompi.co/p/',
  API_URL: 'https://sandbox.wompi.co/v1',
  MONEDA: 'COP',
  AMBIENTE: 'SANDBOX',
  CRED: {
    pub: { prop: 'WOMPI_TEST_PUBLIC_KEY', prefijo: 'pub_test_' },
    integridad: { prop: 'WOMPI_TEST_INTEGRITY_SECRET', prefijo: 'test_integrity_' },
    eventos: { prop: 'WOMPI_TEST_EVENTS_SECRET', prefijo: 'test_events_' }
  },
  MINUTOS_REUSO_INTENTO: 60
};

var ESTADOS_COMISION_SBX = ['NOT_DUE', 'DUE', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'MANUAL_REVIEW'];
/** Estados que significan «exigible y no pagada» → bloquean nuevas oportunidades (solo sandbox). */
var ESTADOS_SBX_BLOQUEAN = ['DUE', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'MANUAL_REVIEW'];

var CONFIG_WOMPI_SBX = [
  ['WOMPI_SANDBOX_ENABLED', 'FALSE', 'Pruebas de cobro con Wompi SANDBOX (sin dinero real). Solo afecta a solicitudes y profesionales de PRUEBA.'],
  ['TEST_EXCHANGE_RATE', '4500', 'TASA FICTICIA DE PRUEBA EUR→COP. NO ES UNA TASA REAL. La fuente oficial de producción está por definir.'],
  ['SANDBOX_BLOQUEO_PRO', 'TRUE', 'SANDBOX: un profesional de PRUEBA con comisión exigible sin pagar no recibe NUEVAS oportunidades.'],
  ['SANDBOX_EMAIL_TEST', '', 'SANDBOX: correo de prueba controlado que recibe los avisos de comisión. Vacío = no se envía ningún correo.'],
  ['SANDBOX_URL_REDIRECCION', 'https://oficiocerca.pages.dev/', 'SANDBOX: página a la que vuelve el navegador tras pagar (solo informativa: no cambia estados).']
];

ESQUEMA['Comisiones Sandbox'] = ['Código OC', 'Código PRO', 'Presupuesto', 'Mano de obra (€)', 'Materiales (€)', 'Porcentaje',
  'Comisión sin tope (€)', 'Tope aplicado', 'Comisión (€)', 'Estado', 'Fecha generación', 'Fecha exigible', 'Referencia vigente',
  'Transaction ID', 'Importe pagado (COP)', 'Moneda', 'Fecha pago', 'Ambiente', 'Notas'];
ESQUEMA['Pagos Sandbox'] = ['Referencia', 'Código OC', 'Código PRO', 'Comisión (€)', 'TEST_EXCHANGE_RATE (ficticia)', 'Importe (COP)',
  'Importe (centavos)', 'Moneda', 'Creado', 'Estado', 'Transaction ID', 'Estado Wompi', 'Fecha estado', 'Ambiente', 'Notas'];
ESQUEMA['Eventos Wompi'] = ['Clave', 'Recibido', 'Evento', 'Ambiente', 'Transaction ID', 'Referencia', 'Estado Wompi', 'Firma válida',
  'Resultado', 'Repeticiones', 'Timestamp'];

/* ---------- instalación (idempotente; no toca pestañas ni datos existentes) ---------- */
function instalarWompiSandbox() {
  var ss = ss_();
  ['Comisiones Sandbox', 'Pagos Sandbox', 'Eventos Wompi'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh) { sh = ss.insertSheet(n); sh.appendRow(ESQUEMA[n]); sh.setFrozenRows(1); sh.setTabColor('#7B1FA2'); }
  });
  var tc = tabla_('Configuración'), existentes = tc.todas().map(function (r) { return String(r['Clave']); });
  CONFIG_WOMPI_SBX.forEach(function (r) { if (existentes.indexOf(r[0]) < 0) tc.agregar({ 'Clave': r[0], 'Valor': r[1], 'Descripción': r[2] }); });
  Logger.log('Wompi SANDBOX instalado. Credenciales de pruebas: ' + JSON.stringify(sbxEstadoCredenciales_()) + ' (solo se informa si existen, nunca su valor).');
}

/** Diagnóstico sin revelar secretos: solo DISPONIBLE / FALTA / ERROR. */
function sbxEstadoCredenciales_() {
  var out = {};
  Object.keys(WOMPI_SBX.CRED).forEach(function (k) {
    try { sbxCred_(k); out[WOMPI_SBX.CRED[k].prop] = 'DISPONIBLE'; } catch (e) { out[WOMPI_SBX.CRED[k].prop] = String(e.message || e).replace(/:.*/, ''); }
  });
  return out;
}
function diagnosticoWompiSandbox() {
  Logger.log('WOMPI_SANDBOX_ENABLED=' + cfgBool_('WOMPI_SANDBOX_ENABLED') + ' · COMMISSION_COLLECTION_ENABLED=' + cfgBool_('COMMISSION_COLLECTION_ENABLED') +
    ' · TEST_EXCHANGE_RATE (ficticia)=' + cfg_('TEST_EXCHANGE_RATE') + ' · credenciales=' + JSON.stringify(sbxEstadoCredenciales_()));
}

/* ---------- guardas ---------- */
function sbxActivo_() { return cfgBool_('WOMPI_SANDBOX_ENABLED'); }
function sbxEsPrueba_(texto) { return /PRUEBA/i.test(String(texto || '')); }
/** Sandbox SOLO se aplica si está activo y la solicitud y el profesional son de PRUEBA. */
function sbxAplica_(sol, p) {
  return !!(sbxActivo_() && sol && p && sbxEsPrueba_(sol['Nombre']) && sbxEsPrueba_(p['Nombre']));
}

/** Lee una credencial de PRUEBAS. Lanza error si falta o si parece de producción (nunca devuelve su valor en mensajes). */
function sbxCred_(tipo) {
  var c = WOMPI_SBX.CRED[tipo];
  if (!c) throw new Error('CREDENCIAL_DESCONOCIDA');
  var v = String(PropertiesService.getScriptProperties().getProperty(c.prop) || '').trim();
  if (!v) throw new Error('FALTA: ' + c.prop);
  if (/prod/i.test(v.slice(0, 16))) throw new Error('PRODUCCION_DETECTADA: ' + c.prop + ' contiene una credencial de producción. Sandbox detenido.');
  if (v.indexOf(c.prefijo) !== 0) throw new Error('PREFIJO_INVALIDO: ' + c.prop + ' debe empezar por ' + c.prefijo);
  return v;
}

/* ---------- cálculo (funciones puras) ---------- */
/** 10 % SOLO sobre mano de obra (materiales excluidos), tope COMISION_MAXIMO_EUR. Reutiliza la regla aprobada comisionDe_. */
function sbxComision_(manoObra, materiales) {
  var mo = Number(manoObra) || 0, com = comisionDe_(mo);
  var sinTope = Math.round(mo * com.pct) / 100;
  return { manoObra: mo, materiales: Number(materiales) || 0, pct: com.pct, sinTope: sinTope, importe: com.importe, topeAplicado: sinTope > com.importe };
}

/** EUR → COP con la TASA FICTICIA DE PRUEBA. Wompi exige COP y amount_in_cents entero. */
function sbxEurACop_(eur, tasa) {
  tasa = Number(tasa);
  if (!(tasa > 0)) throw new Error('TEST_EXCHANGE_RATE no configurada (tasa ficticia de prueba).');
  var cop = Math.round(Number(eur) * tasa);
  return { tasa: tasa, cop: cop, centavos: cop * 100 };
}

/** OC-<ID_SOLICITUD>-COM-<AAAAMMDDhhmmss>. Sin datos personales. */
function sbxReferencia_(oc, fecha) {
  var id = String(oc || '').replace(/^OC-/i, '').replace(/[^0-9A-Za-z]/g, '');
  if (!id) throw new Error('Código OC no válido para la referencia');
  return 'OC-' + id + '-COM-' + Utilities.formatDate(fecha || new Date(), ZONA_HORARIA, 'yyyyMMddHHmmss');
}

/** Firma de integridad oficial: SHA256(<Referencia><Monto en centavos><Moneda><Secreto de integridad>). Solo servidor. */
function sbxFirmaIntegridad_(ref, centavos, moneda, secreto) {
  return hash_(String(ref) + String(centavos) + String(moneda) + String(secreto));
}

function sbxValorRuta_(obj, ruta) {
  return String(ruta || '').split('.').reduce(function (o, k) { return o === undefined || o === null ? undefined : o[k]; }, obj);
}
function sbxIgual_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length || !a.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Checksum de eventos: SHA256(valores de signature.properties tomados de data + timestamp + secreto de eventos). */
function sbxVerificarEvento_(ev, secreto) {
  if (!ev || !ev.data || !ev.signature || !Array.isArray(ev.signature.properties) || !ev.signature.checksum || ev.timestamp === undefined) return false;
  var cadena = ev.signature.properties.map(function (p) { var v = sbxValorRuta_(ev.data, p); return v === undefined || v === null ? '' : String(v); }).join('') +
    String(ev.timestamp) + secreto;
  return sbxIgual_(hash_(cadena), String(ev.signature.checksum).toLowerCase());
}

/* ---------- tablas sandbox ---------- */
function sbxComisionDe_(oc) { return tabla_('Comisiones Sandbox').todas().filter(function (c) { return c['Código OC'] === oc; })[0] || null; }

/** Profesionales bloqueados (solo sandbox): {PRO-XXXX: true}. Vacío si sandbox o bloqueo están desactivados. */
function sbxProsBloqueados_() {
  var out = {};
  if (!sbxActivo_() || !cfgBool_('SANDBOX_BLOQUEO_PRO')) return out;
  try {
    tabla_('Comisiones Sandbox').todas().forEach(function (c) { if (ESTADOS_SBX_BLOQUEAN.indexOf(c['Estado']) >= 0) out[String(c['Código PRO'])] = true; });
  } catch (e) { errorSistema_('sbxProsBloqueados', e); }
  return out;
}
function sbxProBloqueado_(pro) { return !!sbxProsBloqueados_()[String(pro)]; }

/* ---------- ganchos del flujo (no-op fuera de sandbox; un fallo aquí nunca rompe el flujo principal) ---------- */
function sbxAlAceptarPresupuesto_(sol, pr, p) {
  try {
    if (!sbxAplica_(sol, p)) return;
    var oc = sol['Código'];
    if (sbxComisionDe_(oc)) return; // idempotente
    var c = sbxComision_(pr['Mano de obra (€)'], pr['Materiales (€)']);
    tabla_('Comisiones Sandbox').agregar({ 'Código OC': oc, 'Código PRO': p['Código'], 'Presupuesto': pr['ID'], 'Mano de obra (€)': c.manoObra,
      'Materiales (€)': c.materiales, 'Porcentaje': c.pct + ' %', 'Comisión sin tope (€)': c.sinTope, 'Tope aplicado': c.topeAplicado ? 'Sí' : 'No',
      'Comisión (€)': c.importe, 'Estado': 'NOT_DUE', 'Fecha generación': new Date(), 'Ambiente': WOMPI_SBX.AMBIENTE,
      'Notas': 'Materiales excluidos de la base. Aún no exigible: falta la confirmación de fin del cliente.' });
    registrar_('Sandbox', 'Comisión SANDBOX calculada (NOT_DUE)', oc, p['Código'], euros_(c.importe));
  } catch (e) { errorSistema_('sbxAlAceptarPresupuesto', e); }
}

/** Solo cuando el CLIENTE confirma «Sí, está terminado» (doble cierre). */
function sbxAlConfirmarFin_(sol) {
  try {
    var pro = sol['Profesional asignado (PRO)'], p = profesional_(pro);
    if (!sbxAplica_(sol, p)) return;
    var oc = sol['Código'], tc = tabla_('Comisiones Sandbox'), c = sbxComisionDe_(oc);
    if (!c || c['Estado'] !== 'NOT_DUE') return; // idempotente
    tc.poner(c._fila, { 'Estado': 'DUE', 'Fecha exigible': new Date() });
    registrar_('Sandbox', 'Comisión SANDBOX exigible (DUE)', oc, pro, euros_(c['Comisión (€)']));
    var destino = String(cfg_('SANDBOX_EMAIL_TEST') || '').trim();
    if (emailOk_(destino)) encolarCorreo_('sbx-comision-due-' + oc, 'comision_exigible_sbx', 'Profesional (PRUEBA)', destino, oc, pro, {}, true);
    else registrar_('Sandbox', 'Correo SANDBOX no enviado: SANDBOX_EMAIL_TEST vacío', oc, pro, '');
  } catch (e) { errorSistema_('sbxAlConfirmarFin', e); }
}

/* ---------- intento de pago ---------- */
/** Crea (o reutiliza si es reciente y sin transacción) un intento con referencia única. */
function sbxCrearIntento_(oc, ahora) {
  return conLock_(function () {
    if (!sbxActivo_()) return { ok: false, msg: 'Sandbox desactivado.' };
    var c = sbxComisionDe_(oc);
    if (!c) return { ok: false, msg: 'No hay comisión sandbox para ' + oc + '.' };
    if (c['Estado'] === 'PAID') return { ok: false, pagada: true, msg: 'Esta comisión ya está pagada.' };
    if (c['Estado'] === 'NOT_DUE') return { ok: false, msg: 'La comisión todavía no es exigible (falta la confirmación del cliente).' };
    if (c['Estado'] === 'MANUAL_REVIEW') return { ok: false, msg: 'La comisión está en revisión manual.' };
    ahora = ahora || new Date();
    var tp = tabla_('Pagos Sandbox'), pagos = tp.todas();
    var vigente = pagos.filter(function (x) { return x['Referencia'] === c['Referencia vigente'] && x['Estado'] === 'CREADO' && !x['Transaction ID']; })[0];
    if (vigente && ahora.getTime() - new Date(vigente['Creado']).getTime() < WOMPI_SBX.MINUTOS_REUSO_INTENTO * 60000) return { ok: true, pago: vigente, reutilizado: true };
    var conv = sbxEurACop_(c['Comisión (€)'], cfgNum_('TEST_EXCHANGE_RATE', NaN));
    var base = sbxReferencia_(oc, ahora), ref = base, n = 1;
    var usadas = {}; pagos.forEach(function (x) { usadas[x['Referencia']] = 1; });
    while (usadas[ref]) { n++; ref = base + '-' + n; } // referencia repetida → nunca se reutiliza
    var o = { 'Referencia': ref, 'Código OC': oc, 'Código PRO': c['Código PRO'], 'Comisión (€)': Number(c['Comisión (€)']),
      'TEST_EXCHANGE_RATE (ficticia)': conv.tasa, 'Importe (COP)': conv.cop, 'Importe (centavos)': conv.centavos, 'Moneda': WOMPI_SBX.MONEDA,
      'Creado': ahora, 'Estado': 'CREADO', 'Ambiente': WOMPI_SBX.AMBIENTE, 'Notas': 'Tasa ficticia de prueba: no es una tasa real.' };
    o._fila = tp.agregar(o);
    tabla_('Comisiones Sandbox').poner(c._fila, { 'Referencia vigente': ref });
    registrar_('Sandbox', 'Intento de pago SANDBOX creado', oc, c['Código PRO'], ref + ' · ' + euros_(o['Comisión (€)']) + ' → ' + conv.cop + ' COP (tasa ficticia ' + conv.tasa + ')');
    return { ok: true, pago: o };
  });
}

/** Parámetros del Web Checkout de Wompi (firma calculada aquí; el secreto nunca sale del servidor). */
function sbxCheckout_(pago) {
  var pub = sbxCred_('pub'), integ = sbxCred_('integridad');
  var firma = sbxFirmaIntegridad_(pago['Referencia'], pago['Importe (centavos)'], WOMPI_SBX.MONEDA, integ);
  var params = { 'public-key': pub, 'currency': WOMPI_SBX.MONEDA, 'amount-in-cents': String(pago['Importe (centavos)']),
    'reference': pago['Referencia'], 'signature:integrity': firma, 'redirect-url': String(cfg_('SANDBOX_URL_REDIRECCION') || cfg_('URL_WEB') || '') };
  var qs = Object.keys(params).filter(function (k) { return params[k]; }).map(function (k) { return encodeURIComponent(k).replace(/%3A/g, ':') + '=' + encodeURIComponent(params[k]); }).join('&');
  return { url: WOMPI_SBX.CHECKOUT_URL + '?' + qs, firma: firma };
}

/** Página de pago SANDBOX (?wsbx=<token>). */
function sbxPaginaPago_(t) {
  if (!sbxActivo_()) return html_('Pagos de prueba desactivados', '<p>Esta página solo funciona en el modo de pruebas.</p>');
  var tok = leerToken_(t);
  if (!tok || tok['Tipo'] !== 'pago_sbx') return html_('Enlace no válido', '<p>Este enlace no es válido.</p>');
  if (tok.caducado) return html_('Enlace caducado', '<p>Este enlace de prueba ya no está vigente.</p>');
  var oc = tok['Código OC'], c = sbxComisionDe_(oc);
  var aviso = '<div class="err"><b>PRUEBA / SANDBOX</b> · Wompi en modo de pruebas. No se cobra dinero real. Usa solo los datos de prueba de Wompi.</div>';
  if (c && c['Estado'] === 'PAID') return html_('Comisión pagada (SANDBOX)', aviso + '<div class="ok">Esta comisión de prueba ya consta como pagada.</div>');
  var r = sbxCrearIntento_(oc);
  if (!r.ok) return html_('Pago no disponible (SANDBOX)', aviso + '<p>' + esc_(r.msg) + '</p>');
  var pg = r.pago, ck = sbxCheckout_(pg);
  return html_('Comisión OficioCerca · PRUEBA', aviso + filas_([
    ['Concepto', 'Comisión OficioCerca (la paga el profesional, no el cliente)'],
    ['Solicitud', oc],
    ['Importe de referencia', euros_(pg['Comisión (€)'])],
    ['Tasa EUR→COP', String(pg['TEST_EXCHANGE_RATE (ficticia)']) + ' · TEST_EXCHANGE_RATE (ficticia, no es una tasa real)'],
    ['Importe a pagar', Number(pg['Importe (COP)']).toLocaleString('es-CO') + ' COP'],
    ['Referencia', pg['Referencia']]]) +
    '<a class="btn" target="_top" href="' + esc_(ck.url) + '">PAGAR COMISIÓN (SANDBOX)</a>' +
    '<p class="nota">El estado del pago se actualiza solo cuando Wompi lo confirma a OficioCerca, no al volver a esta página.</p>');
}

/* ---------- correo [PRUEBA / SANDBOX] ---------- */
function sbxComponerCorreo_(oc, pro, d) {
  var c = sbxComisionDe_(oc);
  if (!c || ['DUE', 'PAYMENT_FAILED', 'PAYMENT_PENDING'].indexOf(c['Estado']) < 0) return null;
  var tasa = cfgNum_('TEST_EXCHANGE_RATE', NaN), conv = sbxEurACop_(c['Comisión (€)'], tasa);
  var t = crearToken_('pago_sbx', oc, pro, '', Date.now() + 30 * 86400000);
  var url = urlApp_() + (urlApp_().indexOf('?') < 0 ? '?' : '&') + 'wsbx=' + t;
  var titulo = '[PRUEBA / SANDBOX] Comisión exigible · ' + oc;
  var b = [destacado_('PRUEBA / SANDBOX: correo de prueba. No se cobra dinero real.'),
    p_('El cliente ha confirmado que el trabajo terminó. Según las condiciones de la plataforma, la comisión de OficioCerca ya es exigible.'),
    tabla_html_([['Solicitud', oc], ['Mano de obra aceptada', euros_(c['Mano de obra (€)'])], ['Materiales (excluidos)', euros_(c['Materiales (€)'])],
      ['Porcentaje aplicado', c['Porcentaje'] + ' sobre la mano de obra'],
      ['Comisión', euros_(c['Comisión (€)']) + (c['Tope aplicado'] === 'Sí' ? ' (se aplica el máximo de ' + euros_(cfgNum_('COMISION_MAXIMO_EUR', 200)) + ')' : '')],
      ['Equivalente a pagar', conv.cop.toLocaleString('es-CO') + ' COP · TEST_EXCHANGE_RATE ficticia ' + tasa + ' (no es una tasa real)'],
      ['Estado', c['Estado']]]),
    '<div style="text-align:center">' + boton_(url, 'PAGAR COMISIÓN (SANDBOX)', '#7B1FA2') + '</div>',
    p_('Mientras la comisión esté pendiente no recibirás nuevas oportunidades. Tus trabajos en curso no cambian.')];
  var html = plantilla_(titulo, '', b, 'OficioCerca · PRUEBA / SANDBOX');
  return { asunto: '[OficioCerca · PRUEBA / SANDBOX] Comisión exigible ' + oc, html: html, texto: texto_(html), adjuntos: [] };
}

/* ---------- webhook / URL de eventos ---------- */
var SBX_TRANSICION = { APPROVED: 'PAID', PENDING: 'PAYMENT_PENDING', DECLINED: 'PAYMENT_FAILED', ERROR: 'PAYMENT_FAILED', VOIDED: 'PAYMENT_FAILED' };

/** Procesa un evento de Wompi. Solo el evento verificado cambia estados. Idempotente. */
function sbxWebhook_(ev) {
  var te = tabla_('Eventos Wompi');
  var tx = (ev && ev.data && ev.data.transaction) || {};
  var base = { 'Recibido': new Date(), 'Evento': s_(ev && ev.event, 60), 'Ambiente': s_(ev && ev.environment, 20), 'Transaction ID': s_(tx.id, 80),
    'Referencia': s_(tx.reference, 80), 'Estado Wompi': s_(tx.status, 20), 'Timestamp': s_(ev && ev.timestamp, 20), 'Repeticiones': 0 };
  if (!sbxActivo_()) return { ok: true, ignorado: 'sandbox desactivado' };
  if (!ev || ev.environment !== 'test') { te.agregar(Object.assign({}, base, { 'Clave': 'NO-TEST-' + Date.now(), 'Firma válida': '—', 'Resultado': 'RECHAZADO: ambiente distinto de test' })); return { ok: false, error: 'ambiente' }; }
  var secreto;
  try { secreto = sbxCred_('eventos'); } catch (e) { errorSistema_('sbxWebhook', e); return { ok: false, error: 'configuracion' }; }
  if (!sbxVerificarEvento_(ev, secreto)) {
    te.agregar(Object.assign({}, base, { 'Clave': 'FIRMA-' + Date.now(), 'Firma válida': 'NO', 'Resultado': 'RECHAZADO: firma no coincide (no se procesa)' }));
    registrar_('Sandbox', 'Evento Wompi rechazado: firma inválida', '', '', tx.reference || '');
    return { ok: false, error: 'firma' };
  }
  if (ev.event !== 'transaction.updated') {
    te.agregar(Object.assign({}, base, { 'Clave': 'OTRO-' + hash_(JSON.stringify(ev.signature)).slice(0, 16), 'Firma válida': 'SÍ', 'Resultado': 'IGNORADO: tipo de evento' }));
    return { ok: true, ignorado: ev.event };
  }
  return conLock_(function () {
    var clave = tx.id + '|' + tx.status;
    var previo = te.todas().filter(function (r) { return r['Clave'] === clave; })[0];
    if (previo) { te.poner(previo._fila, { 'Repeticiones': Number(previo['Repeticiones'] || 0) + 1 }); return { ok: true, duplicado: true }; }
    var resultado = sbxAplicarTransaccion_(tx);
    te.agregar(Object.assign({}, base, { 'Clave': clave, 'Firma válida': 'SÍ', 'Resultado': resultado }));
    return { ok: true, resultado: resultado };
  });
}

function sbxAplicarTransaccion_(tx) {
  var tp = tabla_('Pagos Sandbox'), tc = tabla_('Comisiones Sandbox');
  var pago = tp.buscar('Referencia', tx.reference);
  if (!pago) return 'MANUAL_REVIEW: referencia desconocida';
  var com = sbxComisionDe_(pago['Código OC']);
  var ahora = new Date();
  if (Number(tx.amount_in_cents) !== Number(pago['Importe (centavos)']) || tx.currency !== WOMPI_SBX.MONEDA) {
    tp.poner(pago._fila, { 'Estado': 'MANUAL_REVIEW', 'Transaction ID': tx.id, 'Estado Wompi': tx.status, 'Fecha estado': ahora, 'Notas': 'Importe o moneda no coinciden con el intento' });
    if (com && com['Estado'] !== 'PAID') tc.poner(com._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Importe/moneda del evento no coinciden (' + tx.reference + ')' });
    alertaAdmin_('sbx-importe-' + tx.id, 'Sandbox', 'Wompi SANDBOX: importe no coincide ' + tx.reference, 'Revisar en «Pagos Sandbox».');
    return 'MANUAL_REVIEW: importe/moneda';
  }
  var anteriorWompi = pago['Estado Wompi'];
  if (anteriorWompi === 'APPROVED' && tx.status !== 'VOIDED') return 'IGNORADO: la transacción ya estaba aprobada';
  tp.poner(pago._fila, { 'Estado': tx.status, 'Transaction ID': tx.id, 'Estado Wompi': tx.status, 'Fecha estado': ahora });
  if (!com) return 'MANUAL_REVIEW: comisión no encontrada';
  var destino = SBX_TRANSICION[tx.status];
  if (!destino) return 'IGNORADO: estado ' + tx.status;
  if (com['Estado'] === 'PAID') {
    if (tx.status === 'VOIDED' && com['Transaction ID'] === tx.id) {
      tc.poner(com._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Pago anulado (VOIDED) tras haberse marcado PAID' });
      return 'MANUAL_REVIEW: pago anulado';
    }
    if (tx.status === 'APPROVED' && com['Transaction ID'] !== tx.id) {
      tp.poner(pago._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Segundo pago aprobado para una comisión ya pagada: revisar devolución' });
      alertaAdmin_('sbx-doble-' + tx.id, 'Sandbox', 'Wompi SANDBOX: doble pago ' + com['Código OC'], 'Revisar en «Pagos Sandbox».');
      return 'MANUAL_REVIEW: doble pago';
    }
    return 'SIN CAMBIOS: comisión ya pagada';
  }
  if (destino === 'PAID') {
    tc.poner(com._fila, { 'Estado': 'PAID', 'Transaction ID': tx.id, 'Referencia vigente': tx.reference, 'Importe pagado (COP)': pago['Importe (COP)'],
      'Moneda': tx.currency, 'Fecha pago': ahora, 'Ambiente': WOMPI_SBX.AMBIENTE });
    registrar_('Sandbox', 'Comisión SANDBOX pagada (PAID) · profesional rehabilitado', com['Código OC'], com['Código PRO'], tx.reference + ' · ' + tx.id);
    return 'PROCESADO: PAID';
  }
  // Un intento anterior (no vigente) que falla no degrada un intento vigente en curso
  if (com['Referencia vigente'] && com['Referencia vigente'] !== tx.reference && destino !== 'PAYMENT_PENDING') return 'PROCESADO: intento no vigente (' + tx.status + ')';
  tc.poner(com._fila, { 'Estado': destino });
  registrar_('Sandbox', 'Comisión SANDBOX → ' + destino, com['Código OC'], com['Código PRO'], tx.reference + ' · ' + tx.status);
  return 'PROCESADO: ' + destino;
}
