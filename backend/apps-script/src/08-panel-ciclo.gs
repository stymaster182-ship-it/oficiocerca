/* ============================================================ CICLO AUTOMÁTICO · PANEL · EDICIONES DEL ADMINISTRADOR · RESUMEN */

/** Activador cada 10 minutos: cola de correo, vencimientos, nuevas búsquedas, métricas y panel. */
function cicloAutomatico() {
  try {
    conLock_(function () {
      procesarCola_();
      altasPendientes_();
      revisarOfertas_();
      motorSeguimiento_();
      recalcularMetricas_();
      estadisticasCorreo_();
    });
  } catch (err) { errorSistema_('cicloAutomatico', err); }
  try { actualizarPanel(); } catch (e) { console.error(e); }
}

/**
 * Red de seguridad: si una edición rápida en la hoja no disparó «alEditar», el profesional queda Activo pero sin
 * correo de alta. Aquí se envía (una sola vez: la clave pro-alta-PRO-xxxx lo hace idempotente).
 */
function altasPendientes_() {
  tabla_('Profesionales').todas().forEach(function (p) {
    if (p['Estado'] !== 'Activo' || !p['Condiciones (versión)'] || !p['Condiciones aceptadas (fecha)'] || !emailOk_(p['Email'])) return;
    var est = encolarCorreo_('pro-alta-' + p['Código'], 'alta_activada', 'Profesional', p['Email'], '', p['Código'], {}, true);
    if (est === 'En cola') registrar_('Sistema', 'Alta activada (comprobación automática)', '', p['Código'], '', 'sistema');
  });
}

function estadisticasCorreo_() {
  var h = tabla_('Historial envíos').todas();
  cfgPoner_('Cuota correo disponible', MailApp.getRemainingDailyQuota());
  cfgPoner_('Última comprobación', fecha_(new Date()));
  cfgPoner_('Correos pendientes', h.filter(function (r) { return r['Estado'] === 'Pendiente por cuota' || r['Estado'] === 'En cola'; }).length);
  cfgPoner_('Envíos fallidos', h.filter(function (r) { return r['Estado'] === 'Fallido'; }).length);
}

function intervenciones_(sol, pros, incs, correos, registro) {
  var out = [];
  sol.forEach(function (s) {
    if (s['Estado'] === 'Revisión manual') out.push(['Otro servicio', s['Código'], (s['Servicio (otro)'] || 'Otro') + ' · ' + s['Zona'], 'Solicitudes: ofrece con «Ofrecer a (PRO manual)», cambia el servicio o cancela']);
    if (s['Estado'] === 'Sin profesional disponible') out.push(['Sin profesional disponible', s['Código'], servicioTxt_(s) + ' · ' + s['Zona'] + ' · ' + s['Plazo'], 'Capta/activa un profesional (se reintenta solo; el cliente puede «Volver a buscar»)']);
    if (s['Estado'] === 'En revisión') out.push(['Servicio en revisión', s['Código'], String(s['Requiere intervención'] || ''), 'Incidencias: rellena «Resultado» (o contacta a las partes)']);
  });
  incs.filter(function (i) { return (i['Tipo'] === 'Incidencia' || i['Tipo'] === 'Ayuda') && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); })
    .sort(function (a, b) { var g = { Grave: 0, Alta: 1 }; return (g[a['Gravedad']] === undefined ? 2 : g[a['Gravedad']]) - (g[b['Gravedad']] === undefined ? 2 : g[b['Gravedad']]); })
    .forEach(function (i) { out.push([(i['Gravedad'] === 'Grave' ? 'INCIDENCIA GRAVE' : i['Tipo'] === 'Ayuda' ? 'Cliente pide ayuda' : 'Incidencia ' + i['Gravedad']), i['ID'] + ' ' + i['Código OC'] + ' ' + i['Código PRO'], String(i['Categoría']) + ': ' + String(i['Descripción']).slice(0, 90), 'Incidencias: rellena «Resultado»']); });
  pros.filter(function (p) { return p['Estado'] === 'Pendiente de revisar'; }).forEach(function (p) {
    out.push(['Profesional por revisar', p['Código'], p['Nombre'] + ' · ' + p['Servicios'] + ' · ' + p['Ciudad'], 'Profesionales: revisa y pon «Activo» (o Baja)']);
  });
  correos.filter(function (c) { return c['Estado'] === 'Fallido'; }).forEach(function (c) { out.push(['Correo fallido', c['Código OC'] || c['Código PRO'], c['Tipo'] + ' → ' + c['Correo'] + ' · ' + c['Último error'], 'Historial envíos: revisa el correo del destinatario']); });
  var hace72 = Date.now() - 72 * 3600000;
  registro.filter(function (r) { return r['Tipo'] === 'Error' && new Date(r['Fecha']).getTime() > hace72; }).slice(-10)
    .forEach(function (r) { out.push(['Error del sistema', fecha_(r['Fecha']), String(r['Detalle']).slice(0, 120), 'Registro (últimas 72 h)']); });
  return out;
}

function actualizarPanel() {
  var sh = ss_().getSheetByName('PANEL');
  if (!sh) return;
  var sol = tabla_('Solicitudes').todas(), pros = tabla_('Profesionales').todas(), incs = tabla_('Incidencias').todas();
  var correos = tabla_('Historial envíos').todas(), registro = tabla_('Registro').todas(), coms = tabla_('Comisiones').todas(), ofertas = tabla_('Ofertas').todas();
  var cuenta = function (estados) { return sol.filter(function (s) { return estados.indexOf(s['Estado']) >= 0; }).length; };
  var conRespaldo = sol.filter(function (s) {
    return ESTADOS_BUSQUEDA.concat(['Esperando decisión cliente']).indexOf(s['Estado']) >= 0 &&
      ofertas.some(function (o) { return o['Código OC'] === s['Código'] && o['Estado'] === 'Respaldo'; });
  }).length;
  var comPend = coms.filter(function (c) { return ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) >= 0; });
  var sumaCom = comPend.reduce(function (a, c) { return a + Number(c['Importe comisión (€)'] || 0); }, 0);
  var comNoHab = coms.filter(function (c) { return c['Estado'] === 'NO_HABILITADA'; });
  var hace7 = Date.now() - 7 * 86400000;
  var inter = intervenciones_(sol, pros, incs, correos, registro);

  var indicadores = [
    ['Solicitudes nuevas', cuenta(['Nueva'])],
    ['Buscando profesional', cuenta(['Buscando profesional'])],
    ['Esperando respuesta profesional', cuenta(['Esperando respuesta profesional'])],
    ['Con candidato de respaldo', conRespaldo],
    ['Esperando respuesta cliente', cuenta(['Esperando decisión cliente', 'Finalización por confirmar'])],
    ['Profesional asignado (sin acuerdo registrado)', cuenta(['Profesional asignado'])],
    ['Trabajos en proceso', cuenta(['Trabajo en proceso'])],
    ['Cierres pendientes (cliente o profesional)', cuenta(['Finalización por confirmar', 'Cierre pendiente del profesional'])],
    ['En revisión (incidencia o sin respuesta)', cuenta(['En revisión'])],
    ['Archivados por inactividad', cuenta(['Archivado por inactividad'])],
    ['Trabajos terminados (confirmados por el cliente)', cuenta(['Comisión pendiente', 'Cerrado'])],
    ['Profesionales pendientes de revisar', pros.filter(function (p) { return p['Estado'] === 'Pendiente de revisar'; }).length],
    ['Profesionales activos', pros.filter(function (p) { return p['Estado'] === 'Activo'; }).length],
    ['Incidencias abiertas', incs.filter(function (i) { return i['Tipo'] === 'Incidencia' && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); }).length],
    ['Comisiones exigibles sin pagar (bloquean nuevas oportunidades)', comPend.length + ' · ' + euros_(sumaCom)],
    ['Comisiones calculadas sin cobro (piloto: cobro ' + (cfgBool_('COMMISSION_COLLECTION_ENABLED') ? 'ACTIVO' : 'NO habilitado') + ')', comNoHab.length + ' · ' + euros_(comNoHab.reduce(function (a, c) { return a + Number(c['Importe comisión (€)'] || 0); }, 0))],
    ['Errores del sistema (7 días)', registro.filter(function (r) { return r['Tipo'] === 'Error' && new Date(r['Fecha']).getTime() > hace7; }).length],
    ['Correos en cola', correos.filter(function (c) { return c['Estado'] === 'Pendiente por cuota' || c['Estado'] === 'En cola'; }).length],
    ['Correos fallidos', correos.filter(function (c) { return c['Estado'] === 'Fallido'; }).length]
  ];

  sh.clear();
  sh.getRange(1, 1, 1, 4).merge().setValue('OFICIOCERCA · PANEL DE CONTROL').setFontSize(16).setFontWeight('bold').setBackground('#13253D').setFontColor('#FFFFFF');
  sh.getRange(2, 1, 1, 4).merge().setValue('Actualizado: ' + fecha_(new Date()) + ' · se actualiza solo cada 10 min (menú OficioCerca → Actualizar panel ahora)').setFontColor('#586374');
  var f = 4;
  sh.getRange(f, 1, 1, 4).merge().setValue('REQUIERE MI INTERVENCIÓN (' + inter.length + ')').setFontWeight('bold').setFontSize(13)
    .setBackground(inter.length ? '#A3262A' : '#2E7D4F').setFontColor('#FFFFFF');
  f++;
  sh.getRange(f, 1, 1, 4).setValues([['Qué', 'Referencia', 'Detalle', 'Dónde actuar']]).setFontWeight('bold').setBackground('#F6F2EB');
  f++;
  if (inter.length) {
    sh.getRange(f, 1, inter.length, 4).setValues(inter).setWrap(true).setVerticalAlignment('top');
    inter.forEach(function (r, i) { if (/GRAVE|Error/.test(r[0])) sh.getRange(f + i, 1, 1, 4).setBackground('#FDECEC'); });
    f += inter.length;
  } else {
    sh.getRange(f, 1, 1, 4).merge().setValue('Nada pendiente. El sistema trabaja solo.').setFontColor('#2E7D4F'); f++;
  }
  f++;
  sh.getRange(f, 1, 1, 4).merge().setValue('ESTADO GENERAL').setFontWeight('bold').setFontSize(13).setBackground('#13253D').setFontColor('#FFFFFF');
  f++;
  sh.getRange(f, 1, indicadores.length, 2).setValues(indicadores);
  indicadores.forEach(function (r, i) {
    var cel = sh.getRange(f + i, 2).setFontWeight('bold').setHorizontalAlignment('center');
    var n = parseInt(r[1], 10) || 0;
    if (/Incidencias|Errores|fallidos|pendientes de revisar/.test(r[0]) && n > 0) cel.setBackground('#FDECEC').setFontColor('#A3262A');
    else if (/cola|respaldo|Esperando/.test(r[0]) && n > 0) cel.setBackground('#FFF4E5');
    else if (n > 0) cel.setBackground('#E8F5EC');
  });
  f += indicadores.length + 1;
  var guia = [
    ['CÓMO INTERVENGO', ''],
    ['Activar un profesional', 'Profesionales → Estado = «Activo» (exige condiciones aceptadas). Desde ese momento entra solo en el matching.'],
    ['Pausar / dar de baja', 'Profesionales → Estado = «Pausado», «En revisión» o «Baja». Sus ofertas abiertas se cierran solas.'],
    ['«Otro servicio»', 'Solicitudes → «Ofrecer a (PRO manual)» con un código PRO activo, o cambia «Servicio (código)» y pon Estado «Buscando profesional».'],
    ['Incidencias', 'Te llega un correo «⚠ Nueva incidencia». Resuélvela en Incidencias → «Resultado» (completo / parcial con «Mano de obra reconocida (€)» / sin trabajo / sin acuerdo / otro).'],
    ['Pausa temporal', 'Incidencias → «Pausa preventiva» o Profesionales → Estado «Pausado»: sin NUEVAS oportunidades; no borra cuenta, historial ni trabajos actuales. Anota el motivo.'],
    ['Cancelar una solicitud', 'Solicitudes → Estado «Cancelada» y escribe el motivo en «Motivo cierre».'],
    ['Cobro de comisiones', 'Configuración → COMMISSION_COLLECTION_ENABLED sigue en FALSE hasta la aprobación de Wompi, la cuenta de abono, la tasa EUR→COP real, la revisión legal/fiscal y la autorización de Steven.'],
    ['Nuevas condiciones', 'Ejecutar pedirAceptacionCondiciones() desde el editor para pedir la versión vigente a los profesionales activos que tengan una anterior.']
  ];
  sh.getRange(f, 1, guia.length, 2).setValues(guia).setWrap(true).setVerticalAlignment('top');
  sh.getRange(f, 1, 1, 2).setFontWeight('bold').setBackground('#F6F2EB');
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 190); sh.setColumnWidth(3, 420); sh.setColumnWidth(4, 360);
  sh.setFrozenRows(2);
}

/* ---------- ediciones del administrador (activador instalable onEdit) ---------- */
function alEditar(e) {
  if (!e || !e.range || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1 || e.range.getRow() < 2) return;
  var sh = e.range.getSheet(), nombre = sh.getName();
  if (!ESQUEMA[nombre]) return;
  var col = ESQUEMA[nombre][e.range.getColumn() - 1], fila = e.range.getRow();
  var usuario = (e.user && e.user.getEmail && e.user.getEmail()) || 'administrador';
  var valor = e.range.getValue(), antes = e.oldValue === undefined ? '' : e.oldValue;
  try {
    conLock_(function () {
      var t = tabla_(nombre), reg = t.todas().filter(function (r) { return r._fila === fila; })[0];
      if (!reg) return;
      if (nombre === 'Profesionales') {
        if (col === 'Estado') {
          if (valor === 'Activo' && (!reg['Condiciones (versión)'] || !reg['Condiciones aceptadas (fecha)'])) {
            t.poner(fila, { 'Estado': antes || 'Pendiente de revisar' });
            t.poner(fila, { 'Notas internas': fecha_(new Date()) + ' No se puede activar: no constan condiciones aceptadas. ' + reg['Notas internas'] });
            registrar_('Admin', 'Activación bloqueada (sin condiciones)', '', reg['Código'], '', usuario);
            return;
          }
          registrar_('Admin', 'Estado profesional: ' + (antes || '—') + ' → ' + valor, '', reg['Código'], '', usuario);
          if (valor === 'Activo' && antes !== 'Activo') {
            encolarCorreo_('pro-alta-' + reg['Código'], 'alta_activada', 'Profesional', reg['Email'], '', reg['Código'], {});
            revisarOfertas_();
          }
          if (valor !== 'Activo' && antes === 'Activo') revisarOfertas_();
        }
        if (col === 'Servicios (códigos)') {
          var lista = listaServicios_(valor);
          t.poner(fila, { 'Servicios (códigos)': lista.join(', '), 'Servicios': lista.map(function (c) { return SERVICIOS[c]; }).join(', ') });
          registrar_('Admin', 'Servicios cambiados', '', reg['Código'], lista.join(', '), usuario);
        }
      }
      if (nombre === 'Solicitudes') {
        // Fechas del seguimiento corregidas a mano: el motor las atiende en el minuto (no espera a la fecha antigua)
        if ((col === 'Fecha estimada fin' || col === 'Acción desde') && valor instanceof Date) {
          programarRevision_(valor);
          registrar_('Admin', col + ' cambiada', reg['Código'], reg['Profesional asignado (PRO)'], (antes || '—') + ' → ' + fecha_(valor), usuario);
        }
        if (col === 'Ofrecer a (PRO manual)' && valor) {
          var res = ofertaManual_(reg, valor);
          t.poner(fila, { 'Notas internas': fecha_(new Date()) + ' Oferta manual ' + valor + ': ' + res + '\n' + reg['Notas internas'] });
          registrar_('Admin', 'Oferta manual', reg['Código'], String(valor).toUpperCase(), res, usuario);
        }
        if (col === 'Servicio (código)') {
          var c = normServicio_(valor);
          t.poner(fila, { 'Servicio (código)': c || antes, 'Servicio': SERVICIOS[c || antes] || '' });
          registrar_('Admin', 'Servicio cambiado', reg['Código'], '', (antes || '—') + ' → ' + (c || 'no válido'), usuario);
        }
        if (col === 'Estado') {
          registrar_('Admin', 'Estado solicitud: ' + (antes || '—') + ' → ' + valor, reg['Código'], '', '', usuario);
          if (valor === 'Cancelada') cancelarSolicitud_(reg, reg['Motivo cierre'] || 'Cancelada por el administrador');
          if (valor === 'Buscando profesional') { t.poner(fila, { 'Requiere intervención': '', 'Decisión cliente': '' }); motor_(reg['Código']); }
        }
      }
      if (nombre === 'Incidencias' && col === 'Resultado' && valor) {
        var res = resolverIncidencia_(reg['ID'], String(valor), usuario);
        t.poner(fila, { 'Notas': fecha_(new Date()) + ' ' + res + (reg['Notas'] ? '\n' + reg['Notas'] : '') });
      }
      if (nombre === 'Incidencias') {
        if (col === 'Pausa preventiva' && valor === true && reg['Código PRO']) {
          var p = profesional_(reg['Código PRO']);
          if (p && p['Estado'] !== 'Pausado' && p['Estado'] !== 'Baja') {
            tabla_('Profesionales').poner(p._fila, { 'Estado': 'Pausado', 'Notas internas': fecha_(new Date()) + ' Pausa preventiva por ' + reg['ID'] + '\n' + p['Notas internas'] });
            revisarOfertas_();
          }
          t.poner(fila, { 'Acción tomada': 'Pausa preventiva (' + fecha_(new Date()) + ')', 'Administrador': usuario, 'Estado': reg['Estado'] === 'Abierta' ? 'En revisión' : reg['Estado'] });
          registrar_('Admin', 'Pausa preventiva', reg['Código OC'], reg['Código PRO'], reg['ID'], usuario);
        }
        if (col === 'Estado') {
          if (['Verificada', 'Descartada', 'Cerrada'].indexOf(valor) >= 0) t.poner(fila, { 'Fecha resolución': new Date(), 'Administrador': usuario });
          registrar_('Admin', 'Incidencia ' + reg['ID'] + ': ' + (antes || '—') + ' → ' + valor, reg['Código OC'], reg['Código PRO'], '', usuario);
          recalcularMetricas_();
        }
      }
      if (nombre === 'Comisiones' && col === 'Estado') registrar_('Admin', 'Comisión: ' + (antes || '—') + ' → ' + valor, reg['Código OC'], reg['Código PRO'], '', usuario);
      if (nombre === 'Configuración') { _cfg = null; registrar_('Admin', 'Configuración: ' + reg['Clave'], '', '', (antes || '—') + ' → ' + valor, usuario); }
    });
  } catch (err) { errorSistema_('alEditar ' + nombre, err); }
  try { actualizarPanel(); } catch (x) { }
}

/** Un único resumen diario al administrador. */
function resumenDiario() {
  try {
    if (!/^s[ií]$/i.test(String(cfg_('RESUMEN_DIARIO')))) return;
    var desde = Date.now() - 86400000, en = function (r, c) { return new Date(r[c]).getTime() > desde; };
    var sol = tabla_('Solicitudes').todas(), reg = tabla_('Registro').todas(), pros = tabla_('Profesionales').todas(), incs = tabla_('Incidencias').todas(), coms = tabla_('Comisiones').todas();
    var acc = function (a) { return reg.filter(function (r) { return en(r, 'Fecha') && r['Acción'] === a; }).length; };
    var inter = intervenciones_(sol, pros, incs, tabla_('Historial envíos').todas(), reg);
    var filas = [
      ['Nuevas solicitudes', sol.filter(function (s) { return en(s, 'Fecha'); }).length],
      ['Asignadas', acc('Asignación automática y contacto compartido')],
      ['Sin profesional disponible (ahora)', sol.filter(function (s) { return s['Estado'] === 'Sin profesional disponible'; }).length],
      ['Acuerdos confirmados', acc('Cliente confirma el acuerdo')],
      ['Trabajos terminados', acc('Cliente confirma finalización')],
      ['Incidencias nuevas', incs.filter(function (i) { return en(i, 'Fecha') && i['Tipo'] === 'Incidencia'; }).length],
      ['Comisiones generadas', coms.filter(function (c) { return en(c, 'Fecha generación'); }).length],
      ['Profesionales nuevos por revisar', pros.filter(function (p) { return en(p, 'Fecha'); }).length],
      ['Requieren tu intervención', inter.length]
    ];
    var hayAlgo = filas.some(function (f) { return Number(f[1]) > 0; });
    if (!hayAlgo) return; // sin actividad ni pendientes: no se envía nada
    var html = tabla_html_(filas) + (inter.length ? '<p><b>Requiere tu intervención:</b></p><ul>' + inter.slice(0, 20).map(function (r) { return '<li>' + esc_(r[0] + ' · ' + r[1] + ' · ' + r[2]) + '</li>'; }).join('') + '</ul>' : '') +
      '<p>Detalle en la pestaña PANEL de la hoja operativa.</p>';
    var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy');
    encolarCorreo_('admin-resumen-' + hoy, 'resumen_diario', 'Administrador', cfg_('ADMIN_EMAIL'), '', '', { fecha: hoy, html: html });
  } catch (err) { errorSistema_('resumenDiario', err); }
}
