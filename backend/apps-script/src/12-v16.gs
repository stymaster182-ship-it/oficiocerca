/* ============================================================ V1.6 · POLÍTICA DE COMISIÓN, TASA EUR→COP, CONDICIONES,
 * OBLIGACIÓN DE COMISIÓN, SERVICIOS ADICIONALES, RECORDATORIOS Y MIGRACIÓN */

/* ---------- 1. POLÍTICA DE COMISIÓN (ÚNICO LUGAR DONDE VIVE LA FÓRMULA) ----------
 * 10 % sobre los primeros 2.000 € de MANO DE OBRA + 5 % sobre el exceso. Sin tope. Materiales excluidos.
 * Ejemplos: 1.000 → 100 · 2.000 → 200 · 3.000 → 250 · 5.000 → 350 · 10.000 → 600. */
var POLITICA_COMISION = { version: 'COM-2026-10-V2', limiteTramo1: 2000, pctTramo1: 10, pctTramo2: 5,
  texto: '10 % sobre los primeros 2.000 € de mano de obra + 5 % sobre el exceso (sin tope, materiales excluidos)' };

function redondeo2_(n) { return Math.round((Number(n) + 1e-9) * 100) / 100; }

/** Comisión sobre la MANO DE OBRA (los materiales no entran nunca). Devuelve importe y desglose. */
function comisionV16_(manoObra) {
  var mo = Math.max(0, Number(manoObra) || 0), P = POLITICA_COMISION;
  var base1 = Math.min(mo, P.limiteTramo1), base2 = Math.max(mo - P.limiteTramo1, 0);
  var t1 = redondeo2_(base1 * P.pctTramo1 / 100), t2 = redondeo2_(base2 * P.pctTramo2 / 100);
  return { manoObra: mo, tramo1: t1, tramo2: t2, importe: redondeo2_(t1 + t2), politica: P.version, texto: P.texto };
}
/** Compatibilidad: comisionDe_(mo) → { pct (texto), importe }. */
function comisionDe_(manoObra) { var c = comisionV16_(manoObra); return { pct: '10 % / 5 %', importe: c.importe, desglose: c }; }

/* ---------- 2. TASA EUR→COP DE PRODUCCIÓN (capa configurable; nunca usa TEST_EXCHANGE_RATE) ----------
 * FX_MODO = SIN_DEFINIR → no hay tasa: el cobro real no puede arrancar.
 * FX_MODO = MANUAL      → FX_EUR_COP_MANUAL + FX_FECHA_MANUAL (máx. FX_MAX_DIAS de antigüedad).
 * FX_MODO = TRM_BCE     → PROPUESTA (pendiente de aprobación, FX_FUENTE_APROBADA = SI):
 *                         TRM oficial USD/COP (Superintendencia Financiera, datos.gov.co, conjunto 32sa-8pi3)
 *                         × tipo de referencia EUR/USD del Banco Central Europeo (API de datos del BCE). */
function tasaEurCop_() {
  var modo = String(cfg_('FX_MODO') || 'SIN_DEFINIR').toUpperCase(), maxDias = cfgNum_('FX_MAX_DIAS', 3);
  if (modo === 'MANUAL') {
    var t = cfgNum_('FX_EUR_COP_MANUAL', NaN), f = fechaIso_(cfg_('FX_FECHA_MANUAL'));
    if (!(t > 1000 && t < 20000)) throw new Error('FX: tasa manual no válida');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('FX: falta la fecha de la tasa manual');
    var edad = (Date.now() - new Date(f + 'T12:00:00Z').getTime()) / 86400000;
    if (edad > maxDias + 0.5) throw new Error('FX: la tasa manual tiene más de ' + maxDias + ' días');
    return { tasa: t, fuente: 'MANUAL (introducida por el administrador)', fecha: f };
  }
  if (modo === 'TRM_BCE') {
    if (!/^s[ií]$/i.test(String(cfg_('FX_FUENTE_APROBADA') || ''))) throw new Error('FX: la fuente TRM_BCE no está aprobada');
    return tasaTrmBce_();
  }
  throw new Error('FX: tasa de producción sin definir (FX_MODO = SIN_DEFINIR)');
}

/** Propuesta TRM × BCE (solo se usa si se aprueba). Cachea 6 h. */
function tasaTrmBce_() {
  var cache = CacheService.getScriptCache(), c = cache.get('FX_TRM_BCE');
  if (c) return JSON.parse(c);
  var trm = JSON.parse(UrlFetchApp.fetch('https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1').getContentText())[0];
  var bce = UrlFetchApp.fetch('https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata').getContentText().trim().split('\n');
  var cab = bce[0].split(','), fila = bce[bce.length - 1].split(',');
  var usdPorEur = Number(fila[cab.indexOf('OBS_VALUE')]), fechaBce = fila[cab.indexOf('TIME_PERIOD')];
  var usdCop = Number(trm.valor);
  if (!(usdPorEur > 0.5 && usdPorEur < 2) || !(usdCop > 1000 && usdCop < 10000)) throw new Error('FX: datos de la fuente fuera de rango');
  var out = { tasa: Math.round(usdCop * usdPorEur * 100) / 100, fuente: 'TRM ' + String(trm.vigenciadesde).slice(0, 10) + ' × BCE EUR/USD ' + fechaBce, fecha: String(trm.vigenciadesde).slice(0, 10) };
  cache.put('FX_TRM_BCE', JSON.stringify(out), 21600);
  return out;
}

/* ---------- 3. OBLIGACIÓN DE COMISIÓN (nace SOLO cuando el cliente confirma el fin) ---------- */
function crearObligacionComision_(sol, p) {
  var oc = sol['Código'], pro = sol['Profesional asignado (PRO)'];
  var ya = comisionDeOC_(oc);
  if (ya) return { estado: ya['Estado'], importe: Number(ya['Importe comisión (€)']) }; // idempotente
  var pres = sol['Presupuesto vigente'] ? tabla_('Presupuestos').buscar('ID', sol['Presupuesto vigente']) : null;
  if (!pres || (pres['Estado'] !== 'Confirmado' && pres['Estado'] !== 'Aceptado')) {
    alertaAdmin_('sin-acuerdo-' + oc, 'Excepción', 'Fin confirmado sin acuerdo confirmado · ' + oc, 'No se ha generado comisión. Revisa la solicitud.');
    return null;
  }
  var c = comisionV16_(pres['Mano de obra (€)']), amb = ambienteCobro_(sol, p), ahora = new Date();
  var estado = amb ? 'DUE' : 'NO_HABILITADA';
  if (c.importe <= 0) estado = 'NO_HABILITADA';
  tabla_('Comisiones').agregar({ 'Código OC': oc, 'Código PRO': pro, 'Profesional': p ? p['Nombre'] : '', 'Presupuesto': pres['ID'],
    'Mano de obra (€)': c.manoObra, 'Materiales (€)': Number(pres['Materiales (€)']) || 0, 'Porcentaje': c.texto, 'Política': c.politica,
    'Tramo 10 % (€)': c.tramo1, 'Tramo 5 % (€)': c.tramo2, 'Importe comisión (€)': c.importe, 'Fecha generación': ahora, 'Estado': estado,
    'Fecha exigible': estado === 'DUE' ? ahora : '', 'Ambiente': amb || 'NO_HABILITADO', 'Moneda': amb ? WOMPI.MONEDA : '',
    'Notas': amb ? '' : 'Cobro no habilitado en el piloto: solo cálculo y registro (no bloquea).' });
  registrar_(amb === 'SANDBOX' ? 'Sandbox' : 'Sistema', 'Comisión generada (' + estado + ')', oc, pro,
    'MO ' + euros_(c.manoObra) + ' → ' + euros_(c.importe) + ' (10 %: ' + euros_(c.tramo1) + ' + 5 %: ' + euros_(c.tramo2) + ')');
  if (estado === 'DUE' && p) {
    var destino = amb === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p['Email'];
    encolarCorreo_('pro-comision-' + oc, 'comision_exigible', 'Profesional', destino, oc, pro, { token: { tipo: 'gestion', dias: 180 } }, true);
  }
  return { estado: estado, importe: c.importe };
}

/** Pago aprobado (evento verificado): cierre del servicio + aviso al profesional. */
function alComisionPagada_(oc, pro) {
  try {
    var sol = solicitud_(oc);
    if (sol['Estado'] === 'Comisión pendiente') actualizarSol_(sol, { 'Estado': 'Cerrado' });
    var p = profesional_(pro), c = comisionDeOC_(oc);
    var destino = c && c['Ambiente'] === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p && p['Email'];
    if (p) encolarCorreo_('pro-pago-ok-' + oc, 'pago_aprobado_pro', 'Profesional', destino, oc, pro, { token: { tipo: 'gestion', dias: 180 } }, true);
  } catch (e) { errorSistema_('alComisionPagada', e); }
}
function avisarPagoRechazado_(oc, pro, ref) {
  try {
    var p = profesional_(pro), c = comisionDeOC_(oc);
    var destino = c && c['Ambiente'] === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p && p['Email'];
    if (p) encolarCorreo_('pro-pago-ko-' + ref, 'pago_rechazado_pro', 'Profesional', destino, oc, pro, { token: { tipo: 'gestion', dias: 180 } }, true);
  } catch (e) { errorSistema_('avisarPagoRechazado', e); }
}

/* ---------- 4. CONDICIONES PARA PROFESIONALES (versionadas; nunca se sobrescribe la aceptación) ---------- */
function condVigente_() { return String(cfg_('PRO_COND_VERSION') || ''); }
function condAlDia_(p) { return String(p['Condiciones (versión)'] || '').trim() === condVigente_() && !!p['Condiciones aceptadas (fecha)']; }

function registrarAceptacionCond_(pro, version, origen) {
  tabla_('Aceptaciones condiciones').agregar({ 'Fecha': new Date(), 'Código PRO': pro, 'Versión': version, 'Origen': origen });
}

/** El profesional acepta la versión vigente desde su enlace (token 'condiciones'). */
function aceptarCondiciones_(pro) {
  return conLock_(function () {
    var p = profesional_(pro);
    if (!p) return { ok: false, msg: 'Profesional no encontrado.' };
    var v = condVigente_();
    if (condAlDia_(p)) return { ok: true, ya: true, msg: 'Ya habías aceptado la versión vigente (' + v + ').' };
    var antes = p['Condiciones (versión)'];
    tabla_('Profesionales').poner(p._fila, { 'Condiciones (versión)': v, 'Condiciones aceptadas (fecha)': new Date() });
    registrarAceptacionCond_(pro, v, 'Enlace de aceptación (antes: ' + (antes || '—') + ')');
    registrar_('Sistema', 'Condiciones aceptadas ' + v, '', pro, 'Antes: ' + (antes || '—'));
    return { ok: true, msg: 'Gracias. Has aceptado las condiciones ' + v + '. Ya puedes recibir nuevas oportunidades.' };
  });
}

/** Pide a los profesionales ACTIVOS con una versión anterior que acepten la vigente (ejecutar a mano; idempotente). */
function pedirAceptacionCondiciones() {
  var v = condVigente_(), n = 0;
  tabla_('Profesionales').todas().forEach(function (p) {
    if (p['Estado'] !== 'Activo' || condAlDia_(p) || !emailOk_(p['Email'])) return;
    encolarCorreo_('pro-cond-' + v + '-' + p['Código'], 'condiciones_pro', 'Profesional', p['Email'], '', p['Código'], { token: { tipo: 'condiciones', dias: 60 } }, true);
    n++;
  });
  Logger.log('Avisos de nuevas condiciones ' + v + ' en cola: ' + n);
}

/* ---------- 5. SERVICIOS ADICIONALES (cada servicio = su propia OC independiente) ---------- */
function grupoDe_(sol) { return String(sol['Grupo cliente'] || sol['Código']); }
function serviciosDelGrupo_(sol) {
  var g = grupoDe_(sol);
  return tabla_('Solicitudes').todas().filter(function (s) { return grupoDe_(s) === g; });
}

/** Nuevo servicio para el MISMO cliente (datos de contacto copiados del servidor, nunca del navegador). */
function anadirServicio_(ocBase, d, mismoPro) {
  return conLock_(function () {
    var base = solicitud_(ocBase);
    var servicio = normServicio_(d.servicio);
    if (!servicio) return { ok: false, msg: 'Elige el servicio.' };
    if (servicio === 'otro' && !String(d.otro || '').trim()) return { ok: false, msg: 'Indica qué servicio necesitas.' };
    if (!String(d.descripcion || '').trim()) return { ok: false, msg: 'Describe brevemente el trabajo.' };
    var plazo = PLAZOS_CLIENTE[d.plazo] ? d.plazo : 'FLEXIBLE';
    if (plazo === 'OTRA_FECHA' && diasHasta_(d.fecha) === null) return { ok: false, msg: 'Elige una fecha válida.' };
    var p = null;
    if (mismoPro) {
      p = profesional_(base['Profesional asignado (PRO)']);
      if (!p) return { ok: false, msg: 'Este servicio no tiene profesional asignado.' };
      if (p['Estado'] !== 'Activo' || !condAlDia_(p) || proBloqueado_(p['Código'])) return { ok: false, msg: 'Ahora mismo este profesional no puede recibir nuevas solicitudes. Puedes pedir el servicio con «Añadir otro servicio» y buscaremos otro profesional.' };
      if (listaServicios_(p['Servicios (códigos)']).indexOf(servicio) < 0) return { ok: false, msg: 'Este profesional no ofrece ese servicio. Usa «Añadir otro servicio».' };
    }
    // Doble clic: mismo grupo, servicio y descripción en 15 min → misma OC
    var hace = Date.now() - 15 * 60000;
    var previa = serviciosDelGrupo_(base).filter(function (s) { return s['Servicio (código)'] === servicio && String(s['Descripción']) === s_(d.descripcion, 3000) && new Date(s['Fecha']).getTime() > hace; })[0];
    if (previa) return { ok: true, ya: true, msg: 'Ese servicio ya estaba registrado (' + previa['Código'] + ').' };
    var code = siguienteCodigo_('SEQ_OC', 'OC-'), manual = SERVICIOS_ACTIVOS.indexOf(servicio) < 0 && !mismoPro;
    var copia = ['Tipo solicitante', 'Nombre', 'Empresa', 'WhatsApp', 'Teléfono alt.', 'Email', 'Ciudad', 'Código postal', 'Zona',
      'Contacto preferido (para el profesional)', 'Versión consentimiento', 'Consentimiento operativo'];
    var fila = { 'Código': code, 'Fecha': new Date(), 'Estado': manual ? 'Revisión manual' : 'Nueva', 'Servicio (código)': servicio, 'Servicio': SERVICIOS[servicio],
      'Servicio (otro)': s_(d.otro, 120), 'Descripción': s_(d.descripcion, 3000), 'Plazo (código)': plazo, 'Plazo': PLAZOS_CLIENTE[plazo].t,
      'Fecha deseada': plazo === 'OTRA_FECHA' ? "'" + String(d.fecha).slice(0, 10) : '', 'Nº fotos': 0, 'Consentimiento (fecha)': new Date(),
      'Origen': 'Seguimiento de ' + ocBase, 'Grupo cliente': grupoDe_(base), 'Origen servicio': mismoPro ? 'Mismo profesional (' + p['Código'] + ')' : 'Añadido por el cliente',
      'Requiere intervención': manual ? 'Otro servicio: revisar demanda' : '', 'Última actualización': new Date() };
    copia.forEach(function (k) { fila[k] = base[k]; });
    tabla_('Solicitudes').agregar(fila);
    if (!base['Grupo cliente']) tabla_('Solicitudes').poner(base._fila, { 'Grupo cliente': grupoDe_(base) });
    registrar_('Sistema', mismoPro ? 'Servicio pedido al mismo profesional' : 'Servicio añadido por el cliente', code, mismoPro ? p['Código'] : '', 'Desde ' + ocBase);
    encolarCorreo_('cli-confirmacion-' + code, 'confirmacion_cliente', 'Cliente', base['Email'], code, '', {}, true);
    if (mismoPro) {
      var nueva = solicitud_(code);
      ofrecer_(nueva, { pro: p, puntos: '', motivo: 'El cliente pidió este servicio al mismo profesional (' + ocBase + ')' });
    } else marcarPendiente_();
    return { ok: true, code: code, msg: 'Hemos registrado el nuevo servicio ' + code + '. ' + (mismoPro ? 'Se lo hemos pedido a tu profesional; si no puede, buscaremos otro compatible.' : 'Buscamos un profesional compatible y te avisaremos por correo.') };
  });
}

/* ---------- 6. RECORDATORIOS (como máximo UNO por acción pendiente; si la acción ya se hizo, no se envía) ---------- */
function recordatoriosV16_() {
  var reg = tabla_('Registro').todas(), ahora = Date.now();
  var desdeAccion = function (oc, accion) { var m = reg.filter(function (r) { return r['Código OC'] === oc && r['Acción'] === accion; }); return m.length ? new Date(m[m.length - 1]['Fecha']).getTime() : 0; };
  tabla_('Solicitudes').todas().forEach(function (s) {
    var oc = s['Código'], est = s['Estado'], pro = s['Profesional asignado (PRO)'], p = pro ? profesional_(pro) : null;
    if (est === 'Acuerdo pendiente del cliente') {
      var vig = s['Presupuesto vigente'];
      var pr = vig ? tabla_('Presupuestos').buscar('ID', vig) : null;
      if (pr && ahora - new Date(pr['Fecha']).getTime() > 2 * 86400000) encolarCorreo_('cli-rec-acuerdo-' + vig, 'recordatorio_acuerdo', 'Cliente', s['Email'], oc, pro, { presupuesto: vig }, true);
    }
    if (est === 'Finalización por confirmar') {
      var d = desdeAccion(oc, 'Profesional indica trabajo finalizado');
      if (d && ahora - d > 3 * 86400000) encolarCorreo_('cli-rec-fin-' + oc + '-' + d, 'recordatorio_fin', 'Cliente', s['Email'], oc, pro, {}, true);
    }
    if (est === 'Profesional asignado' && p && s['Fecha asignación'] && ahora - new Date(s['Fecha asignación']).getTime() > 3 * 86400000)
      encolarCorreo_('pro-rec-acuerdo-' + oc + '-' + pro, 'recordatorio_acuerdo_pro', 'Profesional', p['Email'], oc, pro, { token: { tipo: 'gestion', dias: 180 } }, true);
    // Trabajo en proceso: llega la fecha acordada
    if (est === 'Acuerdo confirmado') {
      var f = fechaIso_(s['Fecha acordada']);
      if (f && f <= Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd')) { actualizarSol_(s, { 'Estado': 'Trabajo en proceso' }); registrar_('Sistema', 'Trabajo en proceso (fecha acordada)', oc, pro, f); }
    }
  });
  tabla_('Comisiones').todas().forEach(function (c) {
    if (c['Estado'] !== 'DUE' || !c['Fecha exigible'] || ahora - new Date(c['Fecha exigible']).getTime() < 3 * 86400000) return;
    var p = profesional_(c['Código PRO']);
    if (!p) return;
    var destino = c['Ambiente'] === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p['Email'];
    encolarCorreo_('pro-rec-comision-' + c['Código OC'], 'recordatorio_comision', 'Profesional', destino, c['Código OC'], c['Código PRO'], { token: { tipo: 'gestion', dias: 180 } }, true);
  });
}

/* ---------- 7. INSTALACIÓN / MIGRACIÓN V1.6 (idempotente; no borra datos) ---------- */
var MIGRACION_ESTADOS_V16 = {
  'Presupuesto enviado': 'Acuerdo pendiente del cliente', 'Presupuesto no aceptado': 'Acuerdo no confirmado', 'Cliente aceptó': 'Acuerdo confirmado',
  'Finalizado': 'Cerrado', 'Valorada': 'Cerrado'
};
var MIGRACION_PRES_V16 = { 'Enviado al cliente': 'Pendiente del cliente', 'Aceptado': 'Confirmado', 'No aceptado': 'No confirmado' };
var MIGRACION_COM_V16 = { 'Generada': 'NO_HABILITADA', 'Pendiente de habilitación': 'NO_HABILITADA', 'Pendiente': 'DUE', 'Pagada': 'PAID', 'En revisión': 'MANUAL_REVIEW', 'Anulada': 'ANULADA' };

function instalarV16() {
  instalarV14();      // pestañas/cabeceras nuevas (Pagos comisión, Eventos Wompi, Aceptaciones condiciones) + configuración
  instalarWompi();    // claves de cobro (sandbox / producción desactivada / tasa)
  conLock_(function () {
    var ts = tabla_('Solicitudes');
    ts.todas().forEach(function (s) {
      var n = MIGRACION_ESTADOS_V16[s['Estado']];
      if (n) { ts.poner(s._fila, { 'Estado': n, 'Cliente confirmó fin (fecha)': /Finalizado|Valorada/.test(s['Estado']) ? (s['Finalizado (fecha)'] || new Date()) : s['Cliente confirmó fin (fecha)'] }); }
    });
    var tp = tabla_('Presupuestos');
    tp.todas().forEach(function (r) { var n = MIGRACION_PRES_V16[r['Estado']]; if (n) tp.poner(r._fila, { 'Estado': n }); });
    var tc = tabla_('Comisiones');
    tc.todas().forEach(function (r) { var n = MIGRACION_COM_V16[r['Estado']]; if (n) tc.poner(r._fila, { 'Estado': n, 'Ambiente': r['Ambiente'] || 'NO_HABILITADO' }); });
    var tcfg = tabla_('Configuración'), obs = tcfg.buscar('Clave', 'COMISION_MAXIMO_EUR');
    if (obs) tcfg.poner(obs._fila, { 'Valor': 'OBSOLETO', 'Descripción': 'Ya no se usa desde V1.6 (sin tope). Política: COMISION_POLITICA.' });
    var obs2 = tcfg.buscar('Clave', 'COMISION_PORCENTAJE');
    if (obs2) tcfg.poner(obs2._fila, { 'Valor': 'OBSOLETO', 'Descripción': 'Ya no se usa desde V1.6. Política: COMISION_POLITICA.' });
    _cfg = null;
    cfgPoner_('COMISION_POLITICA', POLITICA_COMISION.version);
  });
  Logger.log('V1.6 instalada. Condiciones vigentes: ' + condVigente_() + ' · política ' + POLITICA_COMISION.version);
}
