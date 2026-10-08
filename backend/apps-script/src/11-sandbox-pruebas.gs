/* ============================================================ PRUEBAS E2E V1.6 (ejecución MANUAL desde el editor)
 * Crea registros marcados «PRUEBA SANDBOX» (nunca toca registros reales), recorre el flujo real del backend y deja
 * el resultado en el registro de ejecución. No cobra nada (Wompi SANDBOX, tasa ficticia). No revela secretos.
 * Correos: solo a direcciones controladas oficiocerca+…@gmail.com. Al terminar se borran con limpiarDatosDePrueba().
 */
function sbxE2E_nuevoPro_(etiqueta, email) {
  var pro = siguienteCodigo_('SEQ_PRO', 'PRO-'), ahora = new Date();
  tabla_('Profesionales').agregar({ 'Código': pro, 'Fecha': ahora, 'Estado': 'Activo', 'Nombre': 'PRUEBA SANDBOX Profesional ' + etiqueta,
    'Email': email || 'oficiocerca+sbxpro@gmail.com', 'Servicios (códigos)': 'electricidad, fontaneria', 'Servicios': 'Electricidad, Fontanería', 'Ciudad': 'Córdoba',
    'Distancia': 'Toda la ciudad', 'Zonas': 'PRUEBA', 'Con particulares': 'Sí', 'Con empresas': 'Sí', 'Prioridad': 'Normal',
    'Condiciones (versión)': condVigente_(), 'Condiciones aceptadas (fecha)': ahora, 'Origen': 'PRUEBA SANDBOX', 'Notas internas': 'PRUEBA SANDBOX V1.6' });
  registrarAceptacionCond_(pro, condVigente_(), 'PRUEBA SANDBOX');
  return pro;
}
function sbxE2E_nuevaSol_(etiqueta, pro, email) {
  var oc = siguienteCodigo_('SEQ_OC', 'OC-'), ahora = new Date();
  tabla_('Solicitudes').agregar({ 'Código': oc, 'Fecha': ahora, 'Estado': 'Profesional asignado', 'Tipo solicitante': 'Particular',
    'Nombre': 'PRUEBA SANDBOX Cliente ' + etiqueta, 'Email': email || 'oficiocerca+sbxcli@gmail.com', 'Ciudad': 'Córdoba', 'Zona': 'PRUEBA',
    'Servicio (código)': 'electricidad', 'Servicio': 'Electricidad', 'Descripción': 'PRUEBA SANDBOX V1.6 (no es un trabajo real)',
    'Plazo (código)': 'FLEXIBLE', 'Plazo': 'Flexible / sin fecha concreta', 'Origen': 'PRUEBA SANDBOX', 'Profesional asignado (PRO)': pro,
    'Fecha asignación': ahora, 'Contacto preferido (para el profesional)': 'Correo', 'Notas internas': 'PRUEBA SANDBOX V1.6' });
  return oc;
}

/** Caso completo hasta comisión exigible (DUE) + enlace de pago SANDBOX en el registro. */
function sbxE2E_preparar() {
  conLock_(function () {
    if (!sbxActivo_()) throw new Error('Activa WOMPI_SANDBOX_ENABLED = TRUE (sbxE2E_activar).');
    var pro = sbxE2E_nuevoPro_('A'), oc = sbxE2E_nuevaSol_('A', pro);
    var r1 = registrarAcuerdo_(oc, pro, 3000, 800, 7, 'dias', 'PRUEBA');
    var r2 = { ok: true };
    var r3 = marcarFinalizado_(oc, pro, 3200, 'si', 'PRUEBA: un punto de luz adicional', 800);
    var r4 = procesarFinCliente_(oc, 'si', '', false);
    var c = comisionDeOC_(oc);
    PropertiesService.getScriptProperties().setProperty('SBX_E2E_OC', oc);
    Logger.log(oc + ' / ' + pro + ' · MO inicial 3000 € → final 3200 € + materiales 800 € → comisión ' + c['Importe comisión (€)'] + ' € (10 %: ' + c['Tramo 10 % (€)'] + ' + 5 %: ' + c['Tramo 5 % (€)'] +
      ') · ' + c['Estado'] + ' · pasos ' + [r1.ok, r2.ok, r3.ok, r4.ok].join('/') + ' · bloqueado: ' + proBloqueado_(pro));
  });
  sbxE2E_checkout();
}

function sbxE2E_checkout(oc) {
  oc = oc || PropertiesService.getScriptProperties().getProperty('SBX_E2E_OC');
  var r = crearIntentoPago_(oc, new Date());
  if (!r.ok) { Logger.log(oc + ': ' + r.msg); return; }
  var ck = checkoutWompi_(r.pago);
  Logger.log('Referencia ' + r.pago['Referencia'] + ' · ' + r.pago['Comisión (€)'] + ' € × ' + r.pago['Tasa EUR→COP'] + ' (' + r.pago['Fuente tasa'] + ') = ' + r.pago['Importe (COP)'] + ' COP' + (r.reutilizado ? ' (reutilizado)' : ''));
  Logger.log('PAGINA_PAGO ' + urlPagoComision_(oc, r.pago['Código PRO']));
  Logger.log('CHECKOUT ' + ck.url);
}

/** Estado actual (sin secretos). */
function sbxE2E_estado() {
  var oc = PropertiesService.getScriptProperties().getProperty('SBX_E2E_OC'), c = comisionDeOC_(oc), s = solicitud_(oc);
  Logger.log('Solicitud ' + oc + ': ' + s['Estado'] + ' · comisión ' + JSON.stringify(c && { estado: c['Estado'], tx: c['Transaction ID'], ref: c['Referencia vigente'], cop: c['Importe pagado (COP)'], ambiente: c['Ambiente'] }));
  tabla_('Pagos comisión').todas().filter(function (p) { return p['Código OC'] === oc; }).forEach(function (p) {
    Logger.log('Pago ' + p['Referencia'] + ' · ' + p['Estado'] + ' · tx ' + p['Transaction ID'] + ' · ' + p['Importe (COP)'] + ' COP');
  });
  tabla_('Eventos Wompi').todas().slice(-12).forEach(function (e) {
    Logger.log('Evento ' + e['Evento'] + ' · ' + e['Ambiente'] + ' · ' + e['Referencia'] + ' · ' + e['Estado Wompi'] + ' · firma ' + e['Firma válida'] + ' · ' + e['Resultado'] + ' · rep ' + e['Repeticiones']);
  });
  if (c) Logger.log('Profesional ' + c['Código PRO'] + ' bloqueado para nuevas oportunidades: ' + (proBloqueado_(c['Código PRO']) ? 'SÍ' : 'NO'));
}

/** Activa SOLO el sandbox para la prueba (no toca COMMISSION_COLLECTION_ENABLED). */
function sbxE2E_activar() {
  cfgPoner_('WOMPI_SANDBOX_ENABLED', 'TRUE');
  diagnosticoWompiSandbox();
}
/** Desactiva el sandbox (estado por defecto). La capacidad se conserva: basta volver a ejecutar sbxE2E_activar. */
function sbxE2E_desactivar() { cfgPoner_('WOMPI_SANDBOX_ENABLED', 'FALSE'); diagnosticoWompiSandbox(); }

/** Enlaces de PRUEBA sin correo (útil si la cuota diaria de correo está agotada): seguimiento del cliente, oferta abierta y
 * gestión del profesional de cada solicitud PRUEBA de hoy. Tokens de 1 día. Nunca para solicitudes reales. */
function sbxE2E_enlaces() {
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd'), web = String(cfg_('URL_WEB_PRUEBAS') || cfg_('URL_WEB')).replace(/\/?$/, '/');
  var tok = function (tipo, oc, pro, ref) { return crearToken_(tipo, oc, pro, ref || '', Date.now() + 86400000); };
  tabla_('Solicitudes').todas().forEach(function (s) {
    if (!esPrueba_(s['Nombre']) || fechaIso_(s['Fecha']) !== hoy) return;
    var oc = s['Código'];
    Logger.log(oc + ' · ' + s['Estado'] + ' · SEGUIMIENTO ' + web + 'seguimiento/#' + tok('seguimiento', oc, ''));
    tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === oc && o['Estado'] === 'Enviada'; }).forEach(function (o) {
      Logger.log(oc + ' · OFERTA a ' + o['Código PRO'] + ' ' + web + 'gestion/#' + tok('oferta', oc, o['Código PRO'], o['ID']));
    });
    if (s['Profesional asignado (PRO)']) Logger.log(oc + ' · GESTIÓN ' + s['Profesional asignado (PRO)'] + ' ' + web + 'gestion/#' + tok('gestion', oc, s['Profesional asignado (PRO)']));
  });
}
