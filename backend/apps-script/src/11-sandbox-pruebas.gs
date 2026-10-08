/* ============================================================ PRUEBAS E2E WOMPI SANDBOX (ejecución MANUAL desde el editor)
 * Crea registros marcados «PRUEBA SANDBOX» (nunca toca registros reales), recorre el flujo real del backend
 * y deja en el registro de ejecución el enlace del checkout de PRUEBAS. No cobra nada. No revela secretos.
 * Correos: solo a direcciones controladas oficiocerca+sbx…@gmail.com y a SANDBOX_EMAIL_TEST.
 */
function sbxE2E_crearCaso_(etiqueta, mo, mat, completar) {
  return conLock_(function () {
    if (!sbxActivo_()) throw new Error('Activa WOMPI_SANDBOX_ENABLED = TRUE en Configuración.');
    var pro = siguienteCodigo_('SEQ_PRO', 'PRO-'), oc = siguienteCodigo_('SEQ_OC', 'OC-'), ahora = new Date();
    tabla_('Profesionales').agregar({ 'Código': pro, 'Fecha': ahora, 'Estado': 'Activo', 'Nombre': 'PRUEBA SANDBOX Profesional ' + etiqueta,
      'Email': 'oficiocerca+sbxpro@gmail.com', 'Servicios (códigos)': 'electricidad', 'Servicios': 'Electricidad', 'Ciudad': 'Córdoba',
      'Distancia': 'Toda la ciudad', 'Zonas': 'PRUEBA', 'Con particulares': 'Sí', 'Con empresas': 'Sí',
      'Condiciones (versión)': cfg_('PRO_COND_VERSION'), 'Condiciones aceptadas (fecha)': ahora, 'Origen': 'PRUEBA SANDBOX', 'Notas internas': 'PRUEBA SANDBOX Wompi' });
    tabla_('Solicitudes').agregar({ 'Código': oc, 'Fecha': ahora, 'Estado': 'Profesional asignado', 'Tipo solicitante': 'Particular',
      'Nombre': 'PRUEBA SANDBOX Cliente ' + etiqueta, 'Email': 'oficiocerca+sbxcli@gmail.com', 'Ciudad': 'Córdoba', 'Zona': 'PRUEBA',
      'Servicio (código)': 'electricidad', 'Servicio': 'Electricidad', 'Descripción': 'PRUEBA SANDBOX Wompi (no es un trabajo real)',
      'Plazo (código)': 'FLEXIBLE', 'Plazo': 'Flexible / sin fecha concreta', 'Origen': 'PRUEBA SANDBOX', 'Profesional asignado (PRO)': pro,
      'Fecha asignación': ahora, 'Notas internas': 'PRUEBA SANDBOX Wompi' });
    var r1 = registrarPresupuesto_(oc, pro, mo, mat, 'PRUEBA SANDBOX');
    var pres = solicitud_(oc)['Presupuesto vigente'];
    var r2 = procesarRespuestaPresupuesto_(pres, 'aceptar');
    var r3 = completar ? marcarFinalizado_(oc, pro) : null;
    var r4 = completar ? procesarFinCliente_(oc, 'si', '', false) : null;
    var c = sbxComisionDe_(oc);
    Logger.log(etiqueta + ' · ' + oc + ' / ' + pro + ' · MO ' + mo + ' € · materiales ' + mat + ' € → comisión ' + c['Comisión (€)'] + ' € (sin tope ' +
      c['Comisión sin tope (€)'] + ' €, tope aplicado: ' + c['Tope aplicado'] + ') · estado ' + c['Estado'] +
      ' · pasos: ' + [r1.ok, r2.ok, r3 && r3.ok, r4 && r4.ok].join('/'));
    return { oc: oc, pro: pro };
  });
}

/** Caso principal (1000 € MO + 400 € materiales, cerrado por el cliente) + casos J y K. */
function sbxE2E_preparar() {
  var a = sbxE2E_crearCaso_('A', 1000, 400, true);
  sbxE2E_crearCaso_('J-materiales', 800, 5000, false);
  sbxE2E_crearCaso_('K-tope', 3500, 1000, false);
  var bloq = sbxProBloqueado_(a.pro);
  var simulada = { 'Servicio (código)': 'electricidad', 'Tipo solicitante': 'Particular', 'Zona': 'PRUEBA', 'Código postal': '', 'Plazo (código)': 'FLEXIBLE' };
  var recibe = candidatos_(simulada, []).some(function (c) { return c.pro['Código'] === a.pro; });
  Logger.log('Bloqueo ' + a.pro + ': ' + (bloq ? 'BLOQUEADO' : 'no bloqueado') + ' · recibe nuevas oportunidades: ' + (recibe ? 'SÍ' : 'NO'));
  sbxE2E_checkout(a.oc);
}

/** Crea (o reutiliza) el intento y deja el enlace de checkout SANDBOX en el registro. */
function sbxE2E_checkout(oc) {
  oc = oc || PropertiesService.getScriptProperties().getProperty('SBX_E2E_OC');
  PropertiesService.getScriptProperties().setProperty('SBX_E2E_OC', oc);
  var r = sbxCrearIntento_(oc, new Date());
  if (!r.ok) { Logger.log(oc + ': ' + r.msg); return; }
  var ck = sbxCheckout_(r.pago);
  var t = crearToken_('pago_sbx', oc, r.pago['Código PRO'], '', Date.now() + 86400000);
  Logger.log('Referencia ' + r.pago['Referencia'] + ' · ' + r.pago['Comisión (€)'] + ' € × TEST_EXCHANGE_RATE ' + r.pago['TEST_EXCHANGE_RATE (ficticia)'] +
    ' = ' + r.pago['Importe (COP)'] + ' COP' + (r.reutilizado ? ' (reutilizado)' : ''));
  Logger.log('PAGINA_PAGO ' + urlApp_() + '?wsbx=' + t);
  Logger.log('CHECKOUT ' + ck.url);
}

/** Estado actual (sin secretos). */
function sbxE2E_estado() {
  var oc = PropertiesService.getScriptProperties().getProperty('SBX_E2E_OC');
  var c = sbxComisionDe_(oc);
  Logger.log('Comisión ' + oc + ': ' + JSON.stringify(c && { estado: c['Estado'], tx: c['Transaction ID'], ref: c['Referencia vigente'], cop: c['Importe pagado (COP)'], moneda: c['Moneda'], fecha: c['Fecha pago'], ambiente: c['Ambiente'] }));
  tabla_('Pagos Sandbox').todas().filter(function (p) { return p['Código OC'] === oc; }).forEach(function (p) {
    Logger.log('Pago ' + p['Referencia'] + ' · ' + p['Estado'] + ' · tx ' + p['Transaction ID'] + ' · ' + p['Importe (COP)'] + ' COP');
  });
  tabla_('Eventos Wompi').todas().slice(-12).forEach(function (e) {
    Logger.log('Evento ' + e['Evento'] + ' · ' + e['Ambiente'] + ' · ' + e['Referencia'] + ' · ' + e['Estado Wompi'] + ' · firma ' + e['Firma válida'] + ' · ' + e['Resultado'] + ' · rep ' + e['Repeticiones']);
  });
  if (c) {
    var simulada = { 'Servicio (código)': 'electricidad', 'Tipo solicitante': 'Particular', 'Zona': 'PRUEBA', 'Código postal': '', 'Plazo (código)': 'FLEXIBLE' };
    Logger.log('Profesional ' + c['Código PRO'] + ' recibe nuevas oportunidades: ' + (candidatos_(simulada, []).some(function (x) { return x.pro['Código'] === c['Código PRO']; }) ? 'SÍ' : 'NO'));
  }
}

/** Activa SOLO el sandbox para la prueba (no toca COMMISSION_COLLECTION_ENABLED). */
function sbxE2E_activar() {
  cfgPoner_('WOMPI_SANDBOX_ENABLED', 'TRUE');
  if (!emailOk_(cfg_('SANDBOX_EMAIL_TEST'))) cfgPoner_('SANDBOX_EMAIL_TEST', 'oficiocerca+sbxpro@gmail.com');
  diagnosticoWompiSandbox();
}
/** Desactiva el sandbox (vuelve al estado por defecto). */
function sbxE2E_desactivar() { cfgPoner_('WOMPI_SANDBOX_ENABLED', 'FALSE'); diagnosticoWompiSandbox(); }
