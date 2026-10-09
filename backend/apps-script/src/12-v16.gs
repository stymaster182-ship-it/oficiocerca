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
/** moFinal = mano de obra FINAL confirmada (cierre del cliente o resolución de soporte). Nunca materiales. */
function crearObligacionComision_(sol, p, moFinal) {
  var oc = sol['Código'], pro = sol['Profesional asignado (PRO)'];
  var ya = comisionDeOC_(oc);
  if (ya) return { estado: ya['Estado'], importe: Number(ya['Importe comisión (€)']) }; // idempotente
  if (!(Number(moFinal) > 0)) {
    alertaAdmin_('sin-mo-' + oc, 'Excepción', 'Cierre confirmado sin mano de obra final · ' + oc, 'No se ha generado comisión. Revisa la solicitud.');
    return null;
  }
  var pres = { 'ID': sol['Presupuesto vigente'] || '', 'Materiales (€)': sol['Materiales finales (€)'] !== '' ? sol['Materiales finales (€)'] : sol['Materiales aceptados (€)'] };
  var c = comisionV16_(moFinal), amb = ambienteCobro_(sol, p), ahora = new Date();
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

/* ---------- 6. SEGUIMIENTO AUTOMÁTICO (un único motor de avisos y recordatorios) ----------
 * Cada servicio tiene como mucho UNA acción pendiente: «Acción pendiente de» (cliente / profesional / ambos),
 * «Acción desde» (inicio del ciclo), «Plantilla seguimiento» y «Recordatorios enviados» (0–3).
 * Calendario (configurable): aviso 1 al inicio · aviso 2 a las SEG_RECORDATORIO_2_HORAS · último aviso a las
 * SEG_RECORDATORIO_3_HORAS · SEG_CIERRE_HORAS después: si NADIE respondió → «Archivado por inactividad»;
 * si faltaba una sola parte → «En revisión» (soporte avisado). Nunca se cierra, se cobra ni se valora solo.
 * Cualquier acción de las partes detiene el ciclo (pararAccion_). Los correos se recomponen al enviarse:
 * si la acción ya se hizo, no salen. El procesador de cada minuto solo trabaja cuando llega una fecha programada.
 */
var PLANTILLAS_SEGUIMIENTO = ['vencimiento', 'actualizar_plazo', 'confirmar_cierre', 'registrar_cierre', 'registrar_acuerdo'];

function horasSeg_() {
  return [0, cfgNum_('SEG_RECORDATORIO_2_HORAS', 48), cfgNum_('SEG_RECORDATORIO_3_HORAS', 120), cfgNum_('SEG_RECORDATORIO_3_HORAS', 120) + cfgNum_('SEG_CIERRE_HORAS', 48)];
}
function iniciarAccion_(sol, quien, plantilla, cuando) {
  var ahora = cuando ? new Date(cuando) : new Date();
  actualizarSol_(sol, { 'Acción pendiente de': quien, 'Acción desde': ahora, 'Plantilla seguimiento': plantilla, 'Recordatorios enviados': 0, 'Último aviso': '' });
  programarRevision_(ahora);
}
function pararAccion_(sol) {
  if (sol['Acción pendiente de'] || sol['Acción desde']) actualizarSol_(sol, { 'Acción pendiente de': '', 'Acción desde': '', 'Plantilla seguimiento': '', 'Recordatorios enviados': '', 'Último aviso': '' });
}
/** Próxima fecha en la que el motor tiene trabajo (Propiedad PROX_SEGUIMIENTO, en ms). */
function programarRevision_(fecha) {
  var props = PropertiesService.getScriptProperties(), t = new Date(fecha).getTime(), act = Number(props.getProperty('PROX_SEGUIMIENTO')) || Infinity;
  if (t < act) props.setProperty('PROX_SEGUIMIENTO', String(t));
}
function seguimientoVencido_() {
  var t = Number(PropertiesService.getScriptProperties().getProperty('PROX_SEGUIMIENTO'));
  return t > 0 && t <= Date.now();
}

function enviarSeguimiento_(sol, n) {
  var oc = sol['Código'], pro = sol['Profesional asignado (PRO)'], p = pro ? profesional_(pro) : null, quien = sol['Acción pendiente de'];
  var desde = new Date(sol['Acción desde']).getTime(), plantilla = sol['Plantilla seguimiento'];
  var datos = { plantilla: plantilla, n: n, desde: desde, ultimo: n === 2 };
  if (/cliente|ambos/.test(quien)) encolarCorreo_('seg-' + oc + '-' + desde + '-' + n + '-c', 'seguimiento', 'Cliente', sol['Email'], oc, pro, datos, true);
  if (/profesional|ambos/.test(quien) && p) encolarCorreo_('seg-' + oc + '-' + desde + '-' + n + '-p', 'seguimiento', 'Profesional', p['Email'], oc, pro,
    Object.assign({ token: { tipo: 'gestion', dias: 180 } }, datos), true);
}

/** Motor: vencimientos, recordatorios, archivo por inactividad y escalado a revisión manual. Idempotente. */
function motorSeguimiento_() {
  var ahora = Date.now(), H = horasSeg_(), prox = Infinity;
  var acuerdoMs = cfgNum_('SEG_ACUERDO_DIAS', 3) * 86400000;
  var hayPres = {};
  tabla_('Presupuestos').todas().forEach(function (r) { hayPres[r['Código OC']] = 1; });
  tabla_('Solicitudes').todas().forEach(function (s) {
    var est = s['Estado'], oc = s['Código'];
    if (!s['Acción pendiente de']) {
      // Nuevos ciclos: llega la fecha estimada · profesional asignado que aún no registró el acuerdo
      if (est === 'Trabajo en proceso' && s['Fecha estimada fin']) {
        var fin = new Date(s['Fecha estimada fin']).getTime();
        if (fin <= ahora) { iniciarAccion_(s, 'ambos', 'vencimiento', ahora); registrar_('Sistema', 'Llegó la fecha estimada de finalización', oc, s['Profesional asignado (PRO)'], fecha_(fin)); }
        else { prox = Math.min(prox, fin); return; }
      } else if (est === 'Profesional asignado' && !hayPres[oc] && s['Fecha asignación']) {
        var lim = new Date(s['Fecha asignación']).getTime() + acuerdoMs;
        if (lim <= ahora) iniciarAccion_(s, 'profesional', 'registrar_acuerdo', ahora);
        else { prox = Math.min(prox, lim); return; }
      } else return;
    }
    if (ESTADOS_ACTIVOS_SERVICIO.indexOf(est) < 0 || est === 'Archivado por inactividad') { pararAccion_(s); return; }
    var desde = new Date(s['Acción desde']).getTime(), n = Number(s['Recordatorios enviados']) || 0;
    if (n < 3) {
      var cuando = desde + H[n] * 3600000;
      if (cuando <= ahora) {
        enviarSeguimiento_(s, n);
        actualizarSol_(s, { 'Recordatorios enviados': n + 1, 'Último aviso': new Date(ahora) });
        n++;
        // Nunca se escala en la misma pasada en que sale un aviso: la parte siempre conserva su margen tras el último.
        prox = Math.min(prox, n < 3 ? desde + H[n] * 3600000 : Math.max(desde + H[3] * 3600000, ahora + (H[3] - H[2]) * 3600000));
        return;
      }
      prox = Math.min(prox, desde + H[n] * 3600000); return;
    }
    var ultAviso = s['Último aviso'] ? new Date(s['Último aviso']).getTime() : desde + H[2] * 3600000;
    var limite = Math.max(desde + H[3] * 3600000, ultAviso + (H[3] - H[2]) * 3600000);
    if (limite > ahora) { prox = Math.min(prox, limite); return; }
    // Agotados los avisos
    var quien = s['Acción pendiente de'];
    if (quien === 'ambos') {
      actualizarSol_(s, { 'Estado previo': est, 'Estado': 'Archivado por inactividad', 'Escalado por': 'ambos', 'Requiere intervención': '' });
      pararAccion_(s);
      registrar_('Sistema', 'Archivado por inactividad (cierre no confirmado)', oc, s['Profesional asignado (PRO)'], 'Nadie respondió a 3 avisos');
    } else {
      actualizarSol_(s, { 'Estado previo': est, 'Estado': 'En revisión', 'Escalado por': quien, 'Requiere intervención': 'Sin respuesta del ' + quien + ' tras 3 avisos' });
      pararAccion_(s);
      registrar_('Sistema', 'Escalado a revisión manual', oc, s['Profesional asignado (PRO)'], 'Sin respuesta del ' + quien);
      alertaAdmin_('esc-' + oc + '-' + desde, 'Revisión', 'Revisión manual · ' + oc + ' (sin respuesta del ' + quien + ')',
        'El servicio ' + oc + ' necesitaba una acción del ' + quien + ' y no hubo respuesta tras 3 avisos. Queda «En revisión». No se ha cerrado ni cobrado nada.');
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (prox < Infinity) props.setProperty('PROX_SEGUIMIENTO', String(prox)); else props.deleteProperty('PROX_SEGUIMIENTO');
  // Valoración: UN aviso si el cliente confirmó el cierre hace > 24 h y no ha valorado
  var vals = {}; tabla_('Valoraciones').todas().forEach(function (v) { vals[v['Código OC']] = 1; });
  tabla_('Solicitudes').todas().forEach(function (s) {
    if (ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(s['Estado']) < 0 || !s['Cliente confirmó fin (fecha)'] || vals[s['Código']]) return;
    if (ahora - new Date(s['Cliente confirmó fin (fecha)']).getTime() > 86400000) encolarCorreo_('cli-valorar-' + s['Código'], 'valorar_cliente', 'Cliente', s['Email'], s['Código'], s['Profesional asignado (PRO)'], {}, true);
  });
  // Comisión exigible: un recordatorio a los 3 días
  tabla_('Comisiones').todas().forEach(function (c) {
    if (c['Estado'] !== 'DUE' || !c['Fecha exigible'] || ahora - new Date(c['Fecha exigible']).getTime() < 3 * 86400000) return;
    var p = profesional_(c['Código PRO']);
    if (!p) return;
    var destino = c['Ambiente'] === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p['Email'];
    encolarCorreo_('pro-rec-comision-' + c['Código OC'], 'recordatorio_comision', 'Profesional', destino, c['Código OC'], c['Código PRO'], { token: { tipo: 'gestion', dias: 180 } }, true);
  });
}
function recordatoriosV16_() { motorSeguimiento_(); } // compatibilidad

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

/* ---------- 8. INSTALACIÓN / MIGRACIÓN V1.7 (idempotente; no borra datos) ---------- */
var MIGRACION_ESTADOS_V17 = { 'Acuerdo pendiente del cliente': 'Trabajo en proceso', 'Acuerdo no confirmado': 'Profesional asignado',
  'Acuerdo confirmado': 'Trabajo en proceso', 'Sin profesional compatible': 'Sin profesional disponible' };
function instalarV17() {
  instalarV16();
  conLock_(function () {
    var ts = tabla_('Solicitudes');
    ts.todas().forEach(function (s) { var n = MIGRACION_ESTADOS_V17[s['Estado']]; if (n) ts.poner(s._fila, { 'Estado': n }); });
    var tp = tabla_('Presupuestos');
    tp.todas().forEach(function (r) { if (['Pendiente del cliente', 'Confirmado', 'No confirmado'].indexOf(r['Estado']) >= 0) tp.poner(r._fila, { 'Estado': 'Registrado' }); });
    // Fechas con hora exacta visibles en la hoja (el valor guardado siempre incluye la hora)
    var sh = ts.sh;
    ['Fecha registro acuerdo', 'Fecha estimada fin', 'Acción desde', 'Último aviso', 'Fecha asignación'].forEach(function (c) {
      var i = ESQUEMA['Solicitudes'].indexOf(c);
      if (i >= 0 && sh && sh.getRange) { try { sh.getRange(2, i + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('dd/MM/yyyy HH:mm'); } catch (e) { } }
    });
  });
  Logger.log('V1.7 instalada. Condiciones vigentes: ' + condVigente_() + ' · seguimiento: ' + JSON.stringify(horasSeg_()) + ' h');
}
