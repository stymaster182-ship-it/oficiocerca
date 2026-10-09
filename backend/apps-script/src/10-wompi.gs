/* ============================================================ COBRO DE COMISIONES CON WOMPI (V1.6)
 *
 * Una sola estructura para SANDBOX y PRODUCCIÓN (pestañas «Comisiones», «Pagos comisión», «Eventos Wompi»):
 *  - SANDBOX: solo si WOMPI_SANDBOX_ENABLED = TRUE y la solicitud Y el profesional son de PRUEBA (nombre con «PRUEBA»).
 *    Credenciales de pruebas (pub_test_ / test_integrity_ / test_events_) y tasa FICTICIA TEST_EXCHANGE_RATE.
 *  - PRODUCCIÓN: estructura preparada, DESACTIVADA. Solo actúa con COMMISSION_COLLECTION_ENABLED = TRUE, credenciales
 *    de producción (pub_prod_ / prod_integrity_ / prod_events_) y una tasa EUR→COP real y vigente (13 · tasaEurCop_).
 *    Nada de esto se activa sin autorización expresa de Steven.
 *  - Sin cobro activo (lo normal en el piloto): la comisión se calcula y registra como NO_HABILITADA (no bloquea).
 * Los secretos viven en Propiedades del script (nunca en el código ni en la hoja). La redirección del navegador
 * nunca cambia estados: solo el evento de Wompi verificado (checksum SHA-256, comparación en tiempo constante).
 */

var WOMPI = {
  CHECKOUT_URL: 'https://checkout.wompi.co/p/',
  MONEDA: 'COP',
  MINUTOS_REUSO_INTENTO: 60,
  AMBIENTES: {
    SANDBOX: { evento: 'test', cred: { pub: ['WOMPI_TEST_PUBLIC_KEY', 'pub_test_'], integridad: ['WOMPI_TEST_INTEGRITY_SECRET', 'test_integrity_'], eventos: ['WOMPI_TEST_EVENTS_SECRET', 'test_events_'] } },
    PRODUCCION: { evento: 'prod', cred: { pub: ['WOMPI_PROD_PUBLIC_KEY', 'pub_prod_'], integridad: ['WOMPI_PROD_INTEGRITY_SECRET', 'prod_integrity_'], eventos: ['WOMPI_PROD_EVENTS_SECRET', 'prod_events_'] } }
  }
};
/** Estados que significan «exigible y no pagada» → el profesional no recibe NUEVAS oportunidades. */
var ESTADOS_COMISION_BLOQUEAN = ['DUE', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'MANUAL_REVIEW'];

var CONFIG_WOMPI = [
  ['WOMPI_SANDBOX_ENABLED', 'FALSE', 'Pruebas de cobro con Wompi SANDBOX (sin dinero real). Solo afecta a solicitudes y profesionales de PRUEBA.'],
  ['TEST_EXCHANGE_RATE', '4500', 'SOLO SANDBOX: TASA FICTICIA EUR→COP. Nunca se usa en producción.'],
  ['SANDBOX_BLOQUEO_PRO', 'TRUE', 'SANDBOX: un profesional de PRUEBA con comisión exigible sin pagar no recibe NUEVAS oportunidades.'],
  ['SANDBOX_EMAIL_TEST', '', 'SANDBOX: si se rellena, los avisos de comisión de PRUEBA van a este correo en lugar del del profesional de prueba.'],
  ['WOMPI_URL_REDIRECCION', 'https://oficiocerca.pages.dev/', 'Página a la que vuelve el navegador tras pagar (solo informativa: no cambia estados).'],
  ['FX_MODO', 'SIN_DEFINIR', 'Tasa EUR→COP de PRODUCCIÓN: SIN_DEFINIR (bloquea el cobro) · MANUAL (FX_EUR_COP_MANUAL + FX_FECHA_MANUAL) · TRM_BCE (propuesta, pendiente de aprobación).'],
  ['FX_EUR_COP_MANUAL', '', 'Tasa EUR→COP introducida a mano (solo con FX_MODO = MANUAL).'],
  ['FX_FECHA_MANUAL', '', 'Fecha (AAAA-MM-DD) de la tasa manual.'],
  ['FX_MAX_DIAS', '3', 'Antigüedad máxima (días) de la tasa para poder cobrar.'],
  ['FX_FUENTE_APROBADA', 'NO', 'SI = Steven aprobó usar la fuente automática TRM_BCE.']
];

/* ---------- instalación (idempotente; no borra datos) ---------- */
function instalarWompi() {
  var tc = tabla_('Configuración'), existentes = tc.todas().map(function (r) { return String(r['Clave']); });
  CONFIG_WOMPI.forEach(function (r) { if (existentes.indexOf(r[0]) < 0) tc.agregar({ 'Clave': r[0], 'Valor': r[1], 'Descripción': r[2] }); });
  _cfg = null;
  Logger.log('Wompi: ' + JSON.stringify(diagnosticoWompi_()));
}
function instalarWompiSandbox() { instalarWompi(); } // compatibilidad

/** Diagnóstico sin revelar secretos: solo DISPONIBLE / FALTA / error. */
function diagnosticoWompi_() {
  var out = { WOMPI_SANDBOX_ENABLED: cfgBool_('WOMPI_SANDBOX_ENABLED'), COMMISSION_COLLECTION_ENABLED: cfgBool_('COMMISSION_COLLECTION_ENABLED'), FX_MODO: cfg_('FX_MODO') };
  Object.keys(WOMPI.AMBIENTES).forEach(function (a) {
    Object.keys(WOMPI.AMBIENTES[a].cred).forEach(function (k) {
      var prop = WOMPI.AMBIENTES[a].cred[k][0];
      try { credWompi_(a, k); out[prop] = 'DISPONIBLE'; } catch (e) { out[prop] = String(e.message || e).replace(/:.*/, ''); }
    });
  });
  return out;
}
function diagnosticoWompiSandbox() { Logger.log(JSON.stringify(diagnosticoWompi_())); }

/* ---------- guardas ---------- */
function sbxActivo_() { return cfgBool_('WOMPI_SANDBOX_ENABLED'); }
function esPrueba_(texto) { return /PRUEBA/i.test(String(texto || '')); }
function sbxEsPrueba_(texto) { return esPrueba_(texto); }

/** Ambiente de cobro de una solicitud: 'SANDBOX' · 'PRODUCCION' · '' (cobro no habilitado). */
function ambienteCobro_(sol, p) {
  if (sol && p && esPrueba_(sol['Nombre']) && esPrueba_(p['Nombre'])) return sbxActivo_() ? 'SANDBOX' : '';
  if (sol && p && (esPrueba_(sol['Nombre']) || esPrueba_(p['Nombre']))) return ''; // mezcla prueba/real: nunca se cobra
  return cfgBool_('COMMISSION_COLLECTION_ENABLED') ? 'PRODUCCION' : '';
}

/** Credencial del ambiente. Error si falta o si su prefijo no corresponde (nunca devuelve su valor en mensajes). */
function credWompi_(ambiente, tipo) {
  var a = WOMPI.AMBIENTES[ambiente];
  if (!a || !a.cred[tipo]) throw new Error('CREDENCIAL_DESCONOCIDA');
  var prop = a.cred[tipo][0], prefijo = a.cred[tipo][1];
  var v = String(PropertiesService.getScriptProperties().getProperty(prop) || '').trim();
  if (!v) throw new Error('FALTA: ' + prop);
  if (ambiente === 'SANDBOX' && /prod/i.test(v.slice(0, 16))) throw new Error('PRODUCCION_DETECTADA: ' + prop + ' contiene una credencial de producción. Sandbox detenido.');
  if (v.indexOf(prefijo) !== 0) throw new Error('PREFIJO_INVALIDO: ' + prop + ' debe empezar por ' + prefijo);
  return v;
}
function sbxCred_(tipo) { return credWompi_('SANDBOX', tipo); }

/* ---------- utilidades puras ---------- */
function eurACop_(eur, tasa) {
  tasa = Number(tasa);
  if (!(tasa > 0)) throw new Error('Tasa EUR→COP no disponible.');
  var cop = Math.round(Number(eur) * tasa);
  return { tasa: tasa, cop: cop, centavos: cop * 100 };
}
function sbxEurACop_(eur, tasa) { return eurACop_(eur, tasa); }

/** OC-<ID_SOLICITUD>-COM-<AAAAMMDDhhmmss>. Sin datos personales. */
function referenciaPago_(oc, fecha) {
  var id = String(oc || '').replace(/^OC-/i, '').replace(/[^0-9A-Za-z]/g, '');
  if (!id) throw new Error('Código OC no válido para la referencia');
  return 'OC-' + id + '-COM-' + Utilities.formatDate(fecha || new Date(), ZONA_HORARIA, 'yyyyMMddHHmmss');
}
function sbxReferencia_(oc, fecha) { return referenciaPago_(oc, fecha); }

/** Firma de integridad oficial: SHA256(<Referencia><Monto en centavos><Moneda><Secreto de integridad>). Solo servidor. */
function firmaIntegridad_(ref, centavos, moneda, secreto) { return hash_(String(ref) + String(centavos) + String(moneda) + String(secreto)); }
function sbxFirmaIntegridad_(ref, centavos, moneda, secreto) { return firmaIntegridad_(ref, centavos, moneda, secreto); }

function valorRuta_(obj, ruta) { return String(ruta || '').split('.').reduce(function (o, k) { return o === undefined || o === null ? undefined : o[k]; }, obj); }
function igualSeguro_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length || !a.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function sbxIgual_(a, b) { return igualSeguro_(a, b); }
/** Checksum de eventos: SHA256(valores de signature.properties tomados de data + timestamp + secreto de eventos). */
function verificarEventoWompi_(ev, secreto) {
  if (!ev || !ev.data || !ev.signature || !Array.isArray(ev.signature.properties) || !ev.signature.checksum || ev.timestamp === undefined) return false;
  var cadena = ev.signature.properties.map(function (p) { var v = valorRuta_(ev.data, p); return v === undefined || v === null ? '' : String(v); }).join('') +
    String(ev.timestamp) + secreto;
  return igualSeguro_(hash_(cadena), String(ev.signature.checksum).toLowerCase());
}
function sbxVerificarEvento_(ev, secreto) { return verificarEventoWompi_(ev, secreto); }

/* ---------- comisiones y bloqueo ---------- */
function comisionDeOC_(oc) {
  var cs = tabla_('Comisiones').todas().filter(function (c) { return c['Código OC'] === oc && c['Estado'] !== 'ANULADA'; });
  return cs[cs.length - 1] || null;
}
function sbxComisionDe_(oc) { return comisionDeOC_(oc); }

/** Profesionales bloqueados para NUEVAS oportunidades: {PRO-XXXX: true}. Solo comisiones exigibles de un ambiente con cobro. */
function prosBloqueados_() {
  var out = {};
  try {
    var bloqueaSbx = sbxActivo_() && cfgBool_('SANDBOX_BLOQUEO_PRO');
    tabla_('Comisiones').todas().forEach(function (c) {
      if (ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) < 0) return;
      if (c['Ambiente'] === 'SANDBOX' && !bloqueaSbx) return;
      if (c['Ambiente'] === 'PRODUCCION' || c['Ambiente'] === 'SANDBOX') out[String(c['Código PRO'])] = true;
    });
  } catch (e) { errorSistema_('prosBloqueados', e); }
  return out;
}
function proBloqueado_(pro) { return !!prosBloqueados_()[String(pro)]; }
function sbxProsBloqueados_() { return prosBloqueados_(); }
function sbxProBloqueado_(pro) { return proBloqueado_(pro); }

/* ---------- intento de pago ---------- */
/** Tasa para un ambiente: SANDBOX = ficticia; PRODUCCION = tasaEurCop_() (lanza error si no hay una válida). */
function tasaPara_(ambiente) {
  if (ambiente === 'SANDBOX') return { tasa: cfgNum_('TEST_EXCHANGE_RATE', NaN), fuente: 'TEST_EXCHANGE_RATE (ficticia, solo pruebas)', fecha: new Date() };
  return tasaEurCop_();
}

/** Crea (o reutiliza si es reciente y sin transacción) un intento con referencia única. */
function crearIntentoPago_(oc, ahora) {
  return conLock_(function () {
    var c = comisionDeOC_(oc);
    if (!c) return { ok: false, msg: 'No hay ninguna comisión para ' + oc + '.' };
    var amb = c['Ambiente'];
    if (amb === 'SANDBOX' && !sbxActivo_()) return { ok: false, msg: 'Los pagos de prueba están desactivados.' };
    if (amb === 'PRODUCCION' && !cfgBool_('COMMISSION_COLLECTION_ENABLED')) return { ok: false, msg: 'El cobro de comisiones no está habilitado.' };
    if (amb !== 'SANDBOX' && amb !== 'PRODUCCION') return { ok: false, msg: 'Esta comisión no se cobra (cobro no habilitado en el piloto).' };
    if (c['Estado'] === 'PAID') return { ok: false, pagada: true, msg: 'Esta comisión ya está pagada.' };
    if (c['Estado'] === 'MANUAL_REVIEW') return { ok: false, msg: 'Esta comisión está en revisión. Te escribiremos.' };
    if (ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) < 0) return { ok: false, msg: 'Esta comisión todavía no es exigible.' };
    ahora = ahora || new Date();
    var tp = tabla_('Pagos comisión'), pagos = tp.todas();
    var vigente = pagos.filter(function (x) { return x['Referencia'] === c['Referencia vigente'] && x['Estado'] === 'CREADO' && !x['Transaction ID']; })[0];
    if (vigente && ahora.getTime() - new Date(vigente['Creado']).getTime() < WOMPI.MINUTOS_REUSO_INTENTO * 60000) return { ok: true, pago: vigente, reutilizado: true };
    var fx;
    try { fx = tasaPara_(amb); } catch (e) { return { ok: false, msg: 'Ahora no podemos calcular el importe en pesos. Inténtalo más tarde.', error: String(e.message || e) }; }
    var conv = eurACop_(c['Importe comisión (€)'], fx.tasa);
    var base = referenciaPago_(oc, ahora), ref = base, n = 1;
    var usadas = {}; pagos.forEach(function (x) { usadas[x['Referencia']] = 1; });
    while (usadas[ref]) { n++; ref = base + '-' + n; } // una referencia nunca se reutiliza
    var o = { 'Referencia': ref, 'Código OC': oc, 'Código PRO': c['Código PRO'], 'Comisión (€)': Number(c['Importe comisión (€)']),
      'Tasa EUR→COP': conv.tasa, 'Fuente tasa': fx.fuente, 'Fecha tasa': fx.fecha, 'Importe (COP)': conv.cop, 'Importe (centavos)': conv.centavos,
      'Moneda': WOMPI.MONEDA, 'Creado': ahora, 'Estado': 'CREADO', 'Ambiente': amb, 'Notas': amb === 'SANDBOX' ? 'PRUEBA: tasa ficticia, sin dinero real.' : '' };
    o._fila = tp.agregar(o);
    tabla_('Comisiones').poner(c._fila, { 'Referencia vigente': ref, 'Tasa EUR→COP': conv.tasa, 'Fuente tasa': fx.fuente, 'Fecha tasa': fx.fecha });
    registrar_(amb === 'SANDBOX' ? 'Sandbox' : 'Cobro', 'Intento de pago creado', oc, c['Código PRO'], ref + ' · ' + euros_(o['Comisión (€)']) + ' → ' + conv.cop + ' COP (' + fx.fuente + ')');
    return { ok: true, pago: o };
  });
}
function sbxCrearIntento_(oc, ahora) { return crearIntentoPago_(oc, ahora); }

/** Parámetros del Web Checkout de Wompi (firma calculada aquí; el secreto nunca sale del servidor). */
function checkoutWompi_(pago) {
  var amb = pago['Ambiente'];
  var pub = credWompi_(amb, 'pub'), integ = credWompi_(amb, 'integridad');
  var firma = firmaIntegridad_(pago['Referencia'], pago['Importe (centavos)'], WOMPI.MONEDA, integ);
  var params = { 'public-key': pub, 'currency': WOMPI.MONEDA, 'amount-in-cents': String(pago['Importe (centavos)']),
    'reference': pago['Referencia'], 'signature:integrity': firma, 'redirect-url': String(cfg_('WOMPI_URL_REDIRECCION') || cfg_('URL_WEB') || '') };
  var qs = Object.keys(params).filter(function (k) { return params[k]; }).map(function (k) { return encodeURIComponent(k).replace(/%3A/g, ':') + '=' + encodeURIComponent(params[k]); }).join('&');
  return { url: WOMPI.CHECKOUT_URL + '?' + qs, firma: firma };
}
function sbxCheckout_(pago) { return checkoutWompi_(pago); }

/** URL de la página de pago (?wpago=<token>), ligada a UNA comisión. */
function urlPagoComision_(oc, pro) {
  var t = crearToken_('pago_comision', oc, pro, '', Date.now() + 30 * 86400000);
  return String(cfg_('URL_WEB') || 'https://oficiocerca.pages.dev/').replace(/\/?$/, '/') + 'gestion/#' + t; // página propia (evita /macros/u/N con varias cuentas)
}

/** Página de pago (?wpago=<token>; ?wsbx= se mantiene por compatibilidad). */
function paginaPago_(t) {
  var tok = leerToken_(t);
  if (!tok || (tok['Tipo'] !== 'pago_comision' && tok['Tipo'] !== 'pago_sbx')) return html_('Enlace no válido', '<p>Este enlace no es válido.</p>');
  if (tok.caducado) return html_('Enlace caducado', '<p>Este enlace ya no está vigente. Abre el botón del correo más reciente o tu página de gestión del trabajo.</p>');
  var oc = tok['Código OC'], c = comisionDeOC_(oc);
  if (!c) return html_('Pago no disponible', '<p>No hay ninguna comisión pendiente para este trabajo.</p>');
  var sbx = c['Ambiente'] === 'SANDBOX';
  var aviso = sbx ? '<div class="err"><b>PRUEBA / SANDBOX</b> · Wompi en modo de pruebas. No se cobra dinero real. Usa solo los datos de prueba de Wompi.</div>' : '';
  if (c['Estado'] === 'PAID') return html_('Comisión pagada', aviso + '<div class="ok">Esta comisión ya consta como pagada. ¡Gracias!</div>');
  var r = crearIntentoPago_(oc);
  if (!r.ok) return html_('Pago no disponible', aviso + '<p>' + esc_(r.msg) + '</p>');
  var pg = r.pago, ck = checkoutWompi_(pg);
  return html_('Comisión OficioCerca · ' + oc, aviso + filas_([
    ['Concepto', 'Comisión de OficioCerca por el trabajo ' + oc + ' (la paga el profesional, no el cliente)'],
    ['Comisión', euros_(pg['Comisión (€)'])],
    ['Tasa EUR→COP aplicada', String(pg['Tasa EUR→COP']) + ' · ' + pg['Fuente tasa']],
    ['Importe a pagar', Number(pg['Importe (COP)']).toLocaleString('es-CO') + ' COP'],
    ['Referencia', pg['Referencia']]]) +
    '<a class="btn" target="_top" href="' + esc_(ck.url) + '">' + (sbx ? 'PAGAR COMISIÓN (SANDBOX)' : 'PAGAR COMISIÓN') + '</a>' +
    '<p class="nota">El pago se confirma cuando Wompi nos lo comunica (no al volver a esta página). Al confirmarse vuelves a recibir oportunidades automáticamente.</p>');
}
function sbxPaginaPago_(t) { return paginaPago_(t); }

/* ---------- webhook / URL de eventos ---------- */
var TRANSICION_WOMPI = { APPROVED: 'PAID', PENDING: 'PAYMENT_PENDING', DECLINED: 'PAYMENT_FAILED', ERROR: 'PAYMENT_FAILED', VOIDED: 'PAYMENT_FAILED' };

/** Procesa un evento de Wompi. Solo el evento verificado cambia estados. Idempotente (clave tx.id|status). */
function webhookWompi_(ev) {
  var te = tabla_('Eventos Wompi');
  var tx = (ev && ev.data && ev.data.transaction) || {};
  var base = { 'Recibido': new Date(), 'Evento': s_(ev && ev.event, 60), 'Ambiente': s_(ev && ev.environment, 20), 'Transaction ID': s_(tx.id, 80),
    'Referencia': s_(tx.reference, 80), 'Estado Wompi': s_(tx.status, 20), 'Timestamp': s_(ev && ev.timestamp, 20), 'Repeticiones': 0 };
  var amb = ev && ev.environment === 'test' ? 'SANDBOX' : ev && ev.environment === 'prod' ? 'PRODUCCION' : '';
  var habilitado = amb === 'SANDBOX' ? sbxActivo_() : amb === 'PRODUCCION' ? cfgBool_('COMMISSION_COLLECTION_ENABLED') : false;
  if (!habilitado) {
    te.agregar(Object.assign({}, base, { 'Clave': 'AMB-' + Date.now(), 'Firma válida': '—', 'Resultado': 'RECHAZADO: ambiente no habilitado (' + (ev && ev.environment) + ')' }));
    return { ok: false, error: 'ambiente' };
  }
  var secreto;
  try { secreto = credWompi_(amb, 'eventos'); } catch (e) { errorSistema_('webhookWompi', e); return { ok: false, error: 'configuracion' }; }
  if (!verificarEventoWompi_(ev, secreto)) {
    te.agregar(Object.assign({}, base, { 'Clave': 'FIRMA-' + Date.now(), 'Firma válida': 'NO', 'Resultado': 'RECHAZADO: firma no coincide (no se procesa)' }));
    registrar_('Cobro', 'Evento Wompi rechazado: firma inválida', '', '', tx.reference || '');
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
    var resultado = aplicarTransaccion_(tx, amb);
    te.agregar(Object.assign({}, base, { 'Clave': clave, 'Firma válida': 'SÍ', 'Resultado': resultado }));
    return { ok: true, resultado: resultado };
  });
}
function sbxWebhook_(ev) { return webhookWompi_(ev); }

function aplicarTransaccion_(tx, amb) {
  var tp = tabla_('Pagos comisión'), tc = tabla_('Comisiones');
  var pago = tp.buscar('Referencia', tx.reference);
  if (!pago) return 'MANUAL_REVIEW: referencia desconocida';
  if (pago['Ambiente'] !== amb) return 'RECHAZADO: el ambiente del evento no coincide con el del pago';
  var com = comisionDeOC_(pago['Código OC']);
  var ahora = new Date();
  if (Number(tx.amount_in_cents) !== Number(pago['Importe (centavos)']) || tx.currency !== WOMPI.MONEDA) {
    tp.poner(pago._fila, { 'Estado': 'MANUAL_REVIEW', 'Transaction ID': tx.id, 'Estado Wompi': tx.status, 'Fecha estado': ahora, 'Notas': 'Importe o moneda no coinciden con el intento' });
    if (com && com['Estado'] !== 'PAID') tc.poner(com._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Importe/moneda del evento no coinciden (' + tx.reference + ')' });
    alertaAdmin_('wompi-importe-' + tx.id, 'Cobro', 'Wompi: importe no coincide ' + tx.reference, 'Revisar en «Pagos comisión».');
    return 'MANUAL_REVIEW: importe/moneda';
  }
  if (pago['Estado Wompi'] === 'APPROVED' && tx.status !== 'VOIDED') return 'IGNORADO: la transacción ya estaba aprobada';
  tp.poner(pago._fila, { 'Estado': tx.status, 'Transaction ID': tx.id, 'Estado Wompi': tx.status, 'Fecha estado': ahora });
  if (!com) return 'MANUAL_REVIEW: comisión no encontrada';
  var destino = TRANSICION_WOMPI[tx.status];
  if (!destino) return 'IGNORADO: estado ' + tx.status;
  if (com['Estado'] === 'PAID') {
    if (tx.status === 'VOIDED' && com['Transaction ID'] === tx.id) {
      tc.poner(com._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Pago anulado (VOIDED) tras haberse marcado PAID' });
      return 'MANUAL_REVIEW: pago anulado';
    }
    if (tx.status === 'APPROVED' && com['Transaction ID'] !== tx.id) {
      tp.poner(pago._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Segundo pago aprobado para una comisión ya pagada: revisar devolución' });
      alertaAdmin_('wompi-doble-' + tx.id, 'Cobro', 'Wompi: doble pago ' + com['Código OC'], 'Revisar en «Pagos comisión».');
      return 'MANUAL_REVIEW: doble pago';
    }
    return 'SIN CAMBIOS: comisión ya pagada';
  }
  var tipoReg = amb === 'SANDBOX' ? 'Sandbox' : 'Cobro';
  if (destino === 'PAID') {
    tc.poner(com._fila, { 'Estado': 'PAID', 'Transaction ID': tx.id, 'Referencia vigente': tx.reference, 'Importe pagado (COP)': pago['Importe (COP)'],
      'Moneda': tx.currency, 'Fecha pago': ahora, 'Tasa EUR→COP': pago['Tasa EUR→COP'], 'Fuente tasa': pago['Fuente tasa'], 'Fecha tasa': pago['Fecha tasa'] });
    registrar_(tipoReg, 'Comisión pagada (PAID) · profesional desbloqueado', com['Código OC'], com['Código PRO'], tx.reference + ' · ' + tx.id);
    alComisionPagada_(com['Código OC'], com['Código PRO']);
    return 'PROCESADO: PAID';
  }
  // Un intento anterior (no vigente) que falla no degrada un intento vigente en curso
  if (com['Referencia vigente'] && com['Referencia vigente'] !== tx.reference && destino !== 'PAYMENT_PENDING') return 'PROCESADO: intento no vigente (' + tx.status + ')';
  tc.poner(com._fila, { 'Estado': destino });
  registrar_(tipoReg, 'Comisión → ' + destino, com['Código OC'], com['Código PRO'], tx.reference + ' · ' + tx.status);
  if (destino === 'PAYMENT_FAILED') avisarPagoRechazado_(com['Código OC'], com['Código PRO'], tx.reference);
  return 'PROCESADO: ' + destino;
}
