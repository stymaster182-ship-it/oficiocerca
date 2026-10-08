/* ============================================================ PRESUPUESTO · COMISIÓN · FINALIZACIÓN · VALORACIÓN · INCIDENCIAS */

var ESTADOS_PERMITEN_PRESUPUESTO = ['Profesional asignado', 'Presupuesto enviado', 'Presupuesto no aceptado'];

/** El profesional asignado registra (o corrige) su presupuesto. Cada cambio = nueva versión; nada se sobrescribe. */
function registrarPresupuesto_(oc, pro, manoObra, materiales, obs) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Esta solicitud no está asignada a ti.' };
    if (ESTADOS_PERMITEN_PRESUPUESTO.indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no se puede registrar un presupuesto (estado: ' + sol['Estado'] + ').' };
    var mo = num_(manoObra), mat = materiales === '' || materiales === undefined || materiales === null ? 0 : num_(materiales);
    if (isNaN(mo) || mo < 0 || isNaN(mat) || mat < 0) return { ok: false, msg: 'Revisa los importes: usa números (por ejemplo 350 o 350,50).' };
    if (mo > 1000000 || mat > 1000000) return { ok: false, msg: 'Importe demasiado alto. Revisa las cifras.' };
    var total = Math.round((mo + mat) * 100) / 100;
    if (total <= 0) return { ok: false, msg: 'El total debe ser mayor que 0.' };
    var tp = tabla_('Presupuestos');
    var previos = tp.todas().filter(function (r) { return r['Código OC'] === oc; });
    var ultimo = previos[previos.length - 1];
    // Doble clic / recarga: mismo importe y observaciones en los últimos 10 minutos → no se duplica
    if (ultimo && Number(ultimo['Mano de obra (€)']) === mo && Number(ultimo['Materiales (€)']) === mat && String(ultimo['Observaciones']) === s_(obs, 1000) &&
      Date.now() - new Date(ultimo['Fecha']).getTime() < 10 * 60000) return { ok: true, ya: true, msg: 'Este presupuesto ya estaba registrado (versión ' + ultimo['Versión'] + ').' };
    previos.forEach(function (r) { if (r['Estado'] === 'Enviado al cliente') tp.poner(r._fila, { 'Estado': 'Sustituido' }); });
    var version = previos.length + 1, id = 'P-' + oc + '-v' + version;
    tp.agregar({ 'ID': id, 'Fecha': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Versión': version, 'Mano de obra (€)': mo, 'Materiales (€)': mat,
      'Total (€)': total, 'Observaciones': s_(obs, 1000), 'Estado': 'Enviado al cliente' });
    actualizarSol_(sol, { 'Estado': 'Presupuesto enviado', 'Presupuesto vigente': id });
    encolarCorreo_('cli-presupuesto-' + id, 'presupuesto_cliente', 'Cliente', sol['Email'], oc, pro, { presupuesto: id, token: { tipo: 'presupuesto', ref: id } });
    registrar_('Sistema', 'Presupuesto registrado', oc, pro, id + ' · MO ' + euros_(mo) + ' · materiales ' + euros_(mat) + ' · total ' + euros_(total));
    return { ok: true, msg: 'Presupuesto registrado (versión ' + version + ', total ' + euros_(total) + '). Se lo hemos enviado al cliente para que lo acepte o no.' };
  });
}

function comisionDe_(manoObra) {
  var pct = cfgNum_('COMISION_PORCENTAJE', 10), max = cfgNum_('COMISION_MAXIMO_EUR', 200);
  return { pct: pct, importe: Math.min(Math.round(manoObra * pct) / 100, max) };
}

/** Respuesta del CLIENTE a un presupuesto: 'aceptar' | 'rechazar' | 'hablar'. */
function procesarRespuestaPresupuesto_(presId, decision) {
  return conLock_(function () {
    var tp = tabla_('Presupuestos'), pr = tp.buscar('ID', presId);
    if (!pr) return { ok: false, msg: 'Presupuesto no encontrado.' };
    var sol = solicitud_(pr['Código OC']), oc = sol['Código'], pro = pr['Código PRO'];
    var p = profesional_(pro);
    if (pr['Estado'] === 'Aceptado') return { ok: true, ya: true, msg: 'Ya habías aceptado este presupuesto. ¡Gracias!' };
    if (pr['Estado'] === 'No aceptado') return { ok: true, ya: true, msg: 'Ya nos indicaste que no aceptas este presupuesto.' };
    if (pr['Estado'] !== 'Enviado al cliente' || sol['Presupuesto vigente'] !== presId) return { ok: false, msg: 'Este presupuesto fue sustituido por una versión más reciente. Revisa el último correo que te enviamos.' };
    var ahora = new Date();
    if (decision === 'aceptar') {
      var mo = Number(pr['Mano de obra (€)']) || 0, com = comisionDe_(mo);
      tp.poner(pr._fila, { 'Estado': 'Aceptado', 'Respuesta cliente (fecha)': ahora });
      actualizarSol_(sol, { 'Estado': 'Cliente aceptó', 'Mano de obra aceptada (€)': mo, 'Total aceptado (€)': Number(pr['Total (€)']),
        'Comisión (€)': com.importe, 'Fecha aceptación': ahora });
      var tc = tabla_('Comisiones');
      var existe = tc.todas().some(function (c) { return c['Código OC'] === oc && c['Estado'] !== 'Anulada'; });
      if (!existe) tc.agregar({ 'Código OC': oc, 'Código PRO': pro, 'Profesional': p ? p['Nombre'] : '', 'Presupuesto': presId, 'Mano de obra (€)': mo,
        'Porcentaje': com.pct + ' %', 'Importe comisión (€)': com.importe, 'Fecha generación': ahora,
        'Estado': cfgBool_('COMMISSION_COLLECTION_ENABLED') ? 'Pendiente' : 'Pendiente de habilitación',
        'Notas': cfgBool_('COMMISSION_COLLECTION_ENABLED') ? '' : 'Cobro no habilitado: solo cálculo y registro.' });
      sbxAlAceptarPresupuesto_(sol, pr, p); // SANDBOX (no-op fuera de pruebas)
      if (p) encolarCorreo_('pro-pres-aceptado-' + presId, 'presupuesto_aceptado_pro', 'Profesional', p['Email'], oc, pro, { presupuesto: presId, token: { tipo: 'gestion', dias: 180 } });
      registrar_('Sistema', 'Cliente acepta presupuesto · comisión calculada', oc, pro, presId + ' · MO ' + euros_(mo) + ' · comisión ' + euros_(com.importe));
      return { ok: true, msg: 'Has aceptado el presupuesto. El profesional ya está avisado. Cuando termine el trabajo te pediremos que lo confirmes.' };
    }
    if (decision === 'rechazar') {
      tp.poner(pr._fila, { 'Estado': 'No aceptado', 'Respuesta cliente (fecha)': ahora });
      actualizarSol_(sol, { 'Estado': 'Presupuesto no aceptado' });
      if (p) encolarCorreo_('pro-pres-rechazado-' + presId, 'presupuesto_rechazado_pro', 'Profesional', p['Email'], oc, pro, { presupuesto: presId, token: { tipo: 'gestion', dias: 180 } });
      registrar_('Sistema', 'Cliente no acepta presupuesto', oc, pro, presId);
      return { ok: true, msg: 'Hemos registrado que no aceptas este presupuesto. El profesional puede enviarte otra propuesta si lo ve oportuno.' };
    }
    if (decision === 'hablar') {
      if (p) encolarCorreo_('pro-pres-hablar-' + presId, 'presupuesto_hablar_pro', 'Profesional', p['Email'], oc, pro, { presupuesto: presId });
      tp.poner(pr._fila, { 'Notas': 'El cliente quiere hablar (' + fecha_(ahora) + ')' });
      registrar_('Sistema', 'Cliente quiere hablar con el profesional', oc, pro, presId);
      return { ok: true, noConsume: true, msg: 'Hemos pedido al profesional que te contacte. Este enlace sigue sirviendo para aceptar o no el presupuesto más tarde.' };
    }
    return { ok: false, msg: 'Opción no válida.' };
  });
}

/** El profesional indica que terminó. No cierra la solicitud: el cliente debe confirmarlo. */
function marcarFinalizado_(oc, pro) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Esta solicitud no está asignada a ti.' };
    if (sol['Estado'] === 'Finalización por confirmar') return { ok: true, ya: true, msg: 'Ya lo habías indicado. Estamos esperando la confirmación del cliente.' };
    if (sol['Estado'] !== 'Cliente aceptó') return { ok: false, msg: 'Solo se puede marcar como finalizado un trabajo con presupuesto aceptado (estado actual: ' + sol['Estado'] + ').' };
    var n = tabla_('Registro').todas().filter(function (r) { return r['Código OC'] === oc && r['Acción'] === 'Profesional indica trabajo finalizado'; }).length + 1;
    actualizarSol_(sol, { 'Estado': 'Finalización por confirmar' });
    encolarCorreo_('cli-fin-' + oc + '-' + n, 'fin_cliente', 'Cliente', sol['Email'], oc, pro, { token: { tipo: 'fin' } });
    registrar_('Sistema', 'Profesional indica trabajo finalizado', oc, pro, 'Aviso ' + n);
    return { ok: true, msg: 'Gracias. Hemos pedido al cliente que confirme que el trabajo terminó.' };
  });
}

/** Confirmación del cliente: 'si' | 'aun_no' | 'problema' (+ texto y gravedad). */
function procesarFinCliente_(oc, decision, texto, grave) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'], p = profesional_(pro);
    if (['Finalizado', 'Valorada'].indexOf(sol['Estado']) >= 0) return { ok: true, ya: true, msg: 'Ya confirmaste que el trabajo terminó. ¡Gracias!' };
    if (sol['Estado'] !== 'Finalización por confirmar') return { ok: false, msg: 'Este enlace ya no está vigente (estado: ' + sol['Estado'] + ').' };
    if (decision === 'si') {
      actualizarSol_(sol, { 'Estado': 'Finalizado', 'Finalizado (fecha)': new Date() });
      encolarCorreo_('cli-valorar-' + oc, 'valorar_cliente', 'Cliente', sol['Email'], oc, pro, { token: { tipo: 'valorar', dias: 60 } });
      registrar_('Sistema', 'Cliente confirma finalización', oc, pro, '');
      sbxAlConfirmarFin_(sol); // SANDBOX: comisión exigible SOLO tras la confirmación del cliente
      return { ok: true, valorar: true, msg: '¡Gracias! Hemos cerrado el trabajo como finalizado. Te acabamos de enviar un correo para valorar el servicio.' };
    }
    if (decision === 'aun_no') {
      actualizarSol_(sol, { 'Estado': 'Cliente aceptó' });
      if (p) encolarCorreo_('pro-aun-no-' + oc + '-' + Date.now(), 'aun_no_pro', 'Profesional', p['Email'], oc, pro, { token: { tipo: 'gestion', dias: 180 } });
      registrar_('Sistema', 'Cliente indica que aún no ha terminado', oc, pro, 'Discrepancia con la finalización declarada por el profesional');
      return { ok: true, msg: 'Entendido. Avisamos al profesional. Cuando termine, te volveremos a preguntar.' };
    }
    if (decision === 'problema') {
      // Terminó, pero hay un problema: NO se da por finalizado satisfactoriamente; queda pendiente y se revisa
      crearIncidencia_({ tipo: 'Incidencia', oc: oc, pro: pro, origen: 'Cliente (finalización)', categoria: 'Problema con el trabajo', grave: !!grave, texto: texto });
      return { ok: true, msg: 'Lo sentimos. Hemos registrado el problema y una persona de OficioCerca lo revisará y te escribirá.' };
    }
    return { ok: false, msg: 'Opción no válida.' };
  });
}

/** Valoración 1–5 ligada a OC + PRO (una por solicitud). */
function procesarValoracion_(oc, estrellas, comentario) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'];
    estrellas = parseInt(estrellas, 10);
    if (!(estrellas >= 1 && estrellas <= 5)) return { ok: false, msg: 'Elige de 1 a 5 estrellas.' };
    if (['Finalizado', 'Valorada'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Solo se puede valorar un trabajo finalizado.' };
    var tv = tabla_('Valoraciones');
    if (tv.todas().some(function (v) { return v['Código OC'] === oc; })) return { ok: true, ya: true, msg: 'Ya habíamos recibido tu valoración. ¡Gracias!' };
    tv.agregar({ 'Fecha': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Estrellas': estrellas, 'Comentario': s_(comentario, 1000), 'Publicable': 'No' });
    actualizarSol_(sol, { 'Estado': 'Valorada', 'Valoración (1-5)': estrellas });
    var p = profesional_(pro);
    if (estrellas >= 4 && p) encolarCorreo_('pro-buen-trabajo-' + oc, 'buen_trabajo_pro', 'Profesional', p['Email'], oc, pro, { estrellas: estrellas });
    if (estrellas <= 3) crearIncidencia_({ tipo: 'Incidencia', oc: oc, pro: pro, origen: 'Valoración', categoria: 'Valoración baja', grave: false, texto: estrellas + '/5 · ' + s_(comentario, 500) });
    registrar_('Sistema', 'Valoración recibida', oc, pro, estrellas + '/5');
    recalcularMetricas_();
    return { ok: true, msg: '¡Gracias por tu valoración! Nos ayuda a mejorar.' };
  });
}

/** Problema o sugerencia enviada por el cliente (independiente de la valoración). */
function procesarComentarioCliente_(oc, tipo, categoria, texto, grave) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    var previas = tabla_('Incidencias').todas().filter(function (i) { return i['Código OC'] === oc && /^Cliente/.test(i['Origen']); });
    if (previas.length >= 5) return { ok: false, msg: 'Ya hemos recibido varios mensajes sobre esta solicitud. Te escribiremos pronto.' };
    if (previas.some(function (i) { return String(i['Descripción']) === s_(texto, 1500) && i['Categoría'] === categoria; })) return { ok: true, ya: true, msg: 'Ya habíamos recibido este mensaje. ¡Gracias!' };
    var cat = CATEGORIAS_INCIDENCIA.indexOf(categoria) >= 0 ? categoria : 'Otro';
    var sug = tipo === 'sugerencia' || cat === 'Sugerencia para OficioCerca';
    crearIncidencia_({ tipo: sug ? 'Sugerencia' : 'Incidencia', oc: oc, pro: sug ? '' : sol['Profesional asignado (PRO)'], origen: tipo === 'ayuda' ? 'Cliente (pide ayuda)' : 'Cliente',
      categoria: cat, grave: !sug && !!grave, texto: texto });
    return { ok: true, msg: sug ? '¡Gracias por tu sugerencia!' : 'Hemos registrado tu mensaje. Una persona de OficioCerca lo revisará y te escribirá.' };
  });
}

function crearIncidencia_(o) {
  var id = siguienteCodigo_('SEQ_INC', 'INC-');
  var esSug = o.tipo === 'Sugerencia';
  tabla_('Incidencias').agregar({ 'ID': id, 'Fecha': new Date(), 'Tipo': o.tipo, 'Código OC': o.oc || '', 'Código PRO': o.pro || '', 'Origen': o.origen,
    'Categoría': o.categoria, 'Gravedad': o.grave ? 'Grave' : 'Normal', 'Descripción': s_(o.texto, 1500), 'Estado': esSug ? 'Cerrada' : 'Abierta',
    'Pausa preventiva': false, 'Notas': esSug ? 'Sugerencia: no cuenta como incidencia del profesional.' : '' });
  var fila = hoja_('Incidencias').getLastRow();
  hoja_('Incidencias').getRange(fila, tabla_('Incidencias').col('Pausa preventiva')).insertCheckboxes();
  registrar_('Sistema', esSug ? 'Sugerencia recibida' : 'Incidencia creada (' + (o.grave ? 'GRAVE' : 'normal') + ')', o.oc, o.pro, id + ' · ' + o.categoria);
  if (!esSug) alertaAdmin_('inc-' + id, 'Incidencia', (o.grave ? 'GRAVE · ' : '') + 'Incidencia ' + id + ' · ' + (o.oc || '') + ' ' + (o.pro || ''),
    'Origen: ' + o.origen + '\nCategoría: ' + o.categoria + '\nGravedad: ' + (o.grave ? 'Grave (puedes aplicar pausa preventiva marcando «Pausa preventiva» en Incidencias)' : 'Normal') +
    '\n\n' + s_(o.texto, 1500) + '\n\nRevísala en la pestaña Incidencias. Ninguna sanción es automática.');
  return id;
}

/** Métricas internas por profesional (derivadas: se recalculan desde los datos, sin desajustes). */
function recalcularMetricas_() {
  var tp = tabla_('Profesionales'), pros = tp.todas();
  if (!pros.length) return;
  var ofertas = tabla_('Ofertas').todas(), vals = tabla_('Valoraciones').todas(), incs = tabla_('Incidencias').todas();
  var sols = tabla_('Solicitudes').todas(), coms = tabla_('Comisiones').todas();
  var cols = ['Ofertas recibidas', 'Respuestas', 'Aceptadas', 'Asignaciones', 'Completados', 'Tiempo medio respuesta (h)', 'Valoración media',
    'Nº valoraciones', 'Incidencias verificadas', 'Comisiones pendientes', 'Última oferta'];
  var c0 = tp.col(cols[0]);
  var valores = pros.map(function (p) {
    var code = p['Código'];
    var of = ofertas.filter(function (o) { return o['Código PRO'] === code; });
    var resp = of.filter(function (o) { return o['Fecha respuesta'] && /Puede|No puede/.test(o['Respuesta']); });
    var tiempos = resp.map(function (o) { return (new Date(o['Fecha respuesta']) - new Date(o['Fecha envío'])) / 3600000; });
    var v = vals.filter(function (x) { return x['Código PRO'] === code; });
    var ultima = of.reduce(function (m, o) { return Math.max(m, new Date(o['Fecha envío']).getTime()); }, 0);
    return [of.length, resp.length, resp.filter(function (o) { return /^Puede/.test(o['Respuesta']); }).length,
      sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code; }).length,
      sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code && (s['Estado'] === 'Finalizado' || s['Estado'] === 'Valorada'); }).length,
      tiempos.length ? Math.round(tiempos.reduce(function (a, b) { return a + b; }, 0) / tiempos.length * 10) / 10 : '',
      v.length ? Math.round(v.reduce(function (a, x) { return a + Number(x['Estrellas']); }, 0) / v.length * 10) / 10 : '',
      v.length,
      incs.filter(function (i) { return i['Código PRO'] === code && i['Tipo'] === 'Incidencia' && i['Estado'] === 'Verificada'; }).length,
      coms.filter(function (c) { return c['Código PRO'] === code && c['Estado'] === 'Pendiente'; }).length,
      ultima ? new Date(ultima) : ''];
  });
  // Escritura por bloques contiguos (las filas pueden no ser consecutivas si hay huecos)
  pros.forEach(function (p, i) { tp.sh.getRange(p._fila, c0, 1, cols.length).setValues([valores[i]]); });
}
