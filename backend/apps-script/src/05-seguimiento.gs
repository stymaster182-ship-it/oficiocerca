/* ============================================================ V1.7 · ACUERDO EXTERNO · PLAZO · CIERRE · VALORACIÓN · INCIDENCIAS
 *
 * OficioCerca NO cotiza ni negocia precios. Cliente y profesional hablan, visitan y acuerdan POR FUERA.
 * Después el profesional vuelve y REGISTRA EL ACUERDO YA ALCANZADO (mano de obra inicial + duración estimada).
 * La duración es el reloj del seguimiento: al vencer, la plataforma pregunta el estado a las partes (12-v16.gs).
 * Cierre: cualquiera lo inicia; el profesional registra la mano de obra FINAL; el cliente confirma. Solo entonces
 * se calcula la comisión (sobre la mano de obra final confirmada; materiales nunca).
 */

var ESTADOS_PERMITEN_ACUERDO = ['Profesional asignado', 'Trabajo en proceso'];
var ESTADOS_PERMITEN_PRESUPUESTO = ESTADOS_PERMITEN_ACUERDO; // compatibilidad
var ESTADOS_TRAS_CONFIRMAR_FIN = ['Comisión pendiente', 'Cerrado'];
/** Estados en los que el servicio está «vivo» (se puede reportar un problema e indicar el estado del trabajo). */
var ESTADOS_ACTIVOS_SERVICIO = ['Profesional asignado', 'Trabajo en proceso', 'Cierre pendiente del profesional', 'Finalización por confirmar', 'Archivado por inactividad'];

/** Duración «cantidad + unidad» → { ms, texto } o null si no es válida. */
function duracion_(cantidad, unidad) {
  var n = parseInt(cantidad, 10), u = String(unidad || '').toLowerCase().replace('í', 'i');
  if (!(n >= 1 && n <= 365) || !UNIDADES_DURACION[u]) return null;
  var nombres = { horas: ['hora', 'horas'], dias: ['día', 'días'], semanas: ['semana', 'semanas'] };
  return { n: n, unidad: u, ms: n * UNIDADES_DURACION[u], texto: n + ' ' + nombres[u][n === 1 ? 0 : 1] };
}

function anotarPlazo_(sol, texto) {
  var h = String(sol['Historial plazos'] || '');
  return (h ? h + '\n' : '') + fecha_(new Date()) + ' · ' + texto;
}

/** «REGISTRAR ACUERDO ALCANZADO» (el acuerdo ya existe: se negoció fuera de OficioCerca). */
function registrarAcuerdo_(oc, pro, manoObra, materiales, cantidad, unidad, nota) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
    if (ESTADOS_PERMITEN_ACUERDO.indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no se puede registrar el acuerdo (estado: ' + sol['Estado'] + ').' };
    if (String(manoObra === undefined || manoObra === null ? '' : manoObra).trim() === '') return { ok: false, msg: 'Indica la mano de obra acordada.' };
    var mo = num_(manoObra), mat = materiales === '' || materiales === undefined || materiales === null ? 0 : num_(materiales);
    if (isNaN(mo) || mo <= 0 || isNaN(mat) || mat < 0) return { ok: false, msg: 'Revisa los importes: usa números (por ejemplo 350 o 350,50).' };
    if (mo > 1000000 || mat > 1000000) return { ok: false, msg: 'Importe demasiado alto. Revisa las cifras.' };
    var d = duracion_(cantidad, unidad);
    if (!d) return { ok: false, msg: 'Indica la duración estimada (por ejemplo 7 días).' };
    var tp = tabla_('Presupuestos');
    var previos = tp.todas().filter(function (r) { return r['Código OC'] === oc; });
    var ultimo = previos[previos.length - 1];
    if (ultimo && Number(ultimo['Mano de obra (€)']) === mo && Number(ultimo['Materiales (€)']) === mat && String(ultimo['Duración (cantidad)']) === String(d.n) &&
      String(ultimo['Duración (unidad)']) === d.unidad && Date.now() - new Date(ultimo['Fecha']).getTime() < 10 * 60000)
      return { ok: true, ya: true, msg: 'Este acuerdo ya estaba registrado.' };
    previos.forEach(function (r) { if (r['Estado'] !== 'Sustituido') tp.poner(r._fila, { 'Estado': 'Sustituido' }); });
    var ahora = new Date(), fin = new Date(ahora.getTime() + d.ms);
    var version = previos.length + 1, id = 'P-' + oc + '-v' + version;
    tp.agregar({ 'ID': id, 'Fecha': ahora, 'Código OC': oc, 'Código PRO': pro, 'Versión': version, 'Mano de obra (€)': mo, 'Materiales (€)': mat,
      'Total (€)': Math.round((mo + mat) * 100) / 100, 'Observaciones': s_(nota, 1000), 'Estado': 'Registrado', 'Registrado por': pro,
      'Política comisión': POLITICA_COMISION.version, 'Duración (cantidad)': d.n, 'Duración (unidad)': d.unidad, 'Fecha estimada fin': fin });
    actualizarSol_(sol, { 'Estado': 'Trabajo en proceso', 'Presupuesto vigente': id, 'Versión acuerdo': version, 'Fecha registro acuerdo': ahora,
      'Duración estimada': d.texto, 'Fecha estimada fin': fin, 'Mano de obra inicial (€)': mo, 'Materiales aceptados (€)': mat,
      'Historial plazos': anotarPlazo_(sol, (version > 1 ? 'Acuerdo corregido' : 'Acuerdo registrado') + ': ' + d.texto + ' → fin estimado ' + fecha_(fin)) });
    pararAccion_(sol);
    programarRevision_(fin);
    registrar_('Sistema', version > 1 ? 'Acuerdo corregido' : 'Acuerdo alcanzado registrado', oc, pro,
      id + ' · MO ' + euros_(mo) + ' · materiales ' + euros_(mat) + ' · ' + d.texto + ' · fin estimado ' + fecha_(fin));
    return { ok: true, msg: 'Acuerdo registrado. Fin estimado: ' + fecha_(fin) + '. Te recordaremos el seguimiento en esa fecha.' };
  });
}
/** Compatibilidad con llamadas antiguas (V1.5/V1.6): sin duración no se puede registrar. */
function registrarPresupuesto_(oc, pro, manoObra, materiales, obs, cantidad, unidad) { return registrarAcuerdo_(oc, pro, manoObra, materiales, cantidad, unidad, obs); }

/** «Sigue en proceso» del PROFESIONAL: nueva duración/fecha (se conserva el historial). */
function actualizarPlazo_(oc, pro, cantidad, unidad, nota) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
    if (['Trabajo en proceso', 'Archivado por inactividad'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no se puede actualizar el plazo (estado: ' + sol['Estado'] + ').' };
    if (!sol['Presupuesto vigente']) return { ok: false, msg: 'Primero registra el acuerdo alcanzado.' };
    var d = duracion_(cantidad, unidad);
    if (!d) return { ok: false, msg: 'Indica cuánto tiempo más necesitas (por ejemplo 3 días).' };
    var fin = new Date(Date.now() + d.ms);
    if (sol['Estado'] === 'Archivado por inactividad') registrar_('Sistema', 'Servicio reabierto', oc, pro, 'Por el profesional');
    actualizarSol_(sol, { 'Estado': 'Trabajo en proceso', 'Fecha estimada fin': fin, 'Duración estimada': d.texto,
      'Historial plazos': anotarPlazo_(sol, 'Plazo actualizado por el profesional: +' + d.texto + ' → fin estimado ' + fecha_(fin) + (nota ? ' (' + s_(nota, 200) + ')' : '')) });
    pararAccion_(sol);
    programarRevision_(fin);
    registrar_('Sistema', 'Plazo actualizado', oc, pro, d.texto + ' · fin estimado ' + fecha_(fin));
    return { ok: true, msg: 'Plazo actualizado. Nuevo fin estimado: ' + fecha_(fin) + '.' };
  });
}

/** «Sigue en proceso» del CLIENTE: se pide al profesional que actualice el plazo. */
function clienteSigueEnProceso_(oc) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (['Trabajo en proceso', 'Archivado por inactividad', 'Finalización por confirmar'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no aplica (estado: ' + sol['Estado'] + ').' };
    if (sol['Estado'] !== 'Trabajo en proceso') registrar_('Sistema', sol['Estado'] === 'Archivado por inactividad' ? 'Servicio reabierto' : 'El cliente indica que aún no ha terminado', oc, sol['Profesional asignado (PRO)'], 'Por el cliente');
    actualizarSol_(sol, { 'Estado': 'Trabajo en proceso', 'Historial plazos': anotarPlazo_(sol, 'El cliente indica que el trabajo sigue en proceso') });
    iniciarAccion_(sol, 'profesional', 'actualizar_plazo');
    registrar_('Sistema', 'Cliente: el trabajo sigue en proceso', oc, sol['Profesional asignado (PRO)'], '');
    return { ok: true, msg: 'Gracias. Hemos pedido al profesional que actualice la fecha estimada.' };
  });
}

/** «MARCAR TRABAJO COMO TERMINADO» (profesional): valor FINAL de mano de obra + adicionales + motivo. */
function marcarFinalizado_(oc, pro, moFinal, adicionales, motivo, matFinal) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
    if (sol['Estado'] === 'Finalización por confirmar') return { ok: true, ya: true, msg: 'Ya lo habías indicado. Estamos esperando la confirmación del cliente.' };
    if (['Trabajo en proceso', 'Cierre pendiente del profesional', 'Archivado por inactividad', 'Profesional asignado'].indexOf(sol['Estado']) < 0)
      return { ok: false, msg: 'Ahora no se puede cerrar este trabajo (estado: ' + sol['Estado'] + ').' };
    if (String(moFinal === undefined || moFinal === null ? '' : moFinal).trim() === '') return { ok: false, msg: 'Indica el valor final de la mano de obra.' };
    var mo = num_(moFinal), mat = matFinal === '' || matFinal === undefined || matFinal === null ? '' : num_(matFinal);
    if (isNaN(mo) || mo <= 0 || mo > 1000000 || (mat !== '' && (isNaN(mat) || mat < 0))) return { ok: false, msg: 'Revisa los importes.' };
    var inicial = sol['Mano de obra inicial (€)'] === '' ? null : Number(sol['Mano de obra inicial (€)']);
    var cambia = inicial !== null && Math.abs(mo - inicial) >= 0.01;
    var adic = adicionales === 'si' || adicionales === true || adicionales === 'Sí';
    if (cambia && !String(motivo || '').trim()) return { ok: false, msg: 'El valor final es distinto del inicial: explica brevemente el motivo.' };
    var iniciadoPor = sol['Estado'] === 'Cierre pendiente del profesional' ? 'Cliente' : 'Profesional';
    if (sol['Estado'] === 'Archivado por inactividad') registrar_('Sistema', 'Servicio reabierto', oc, pro, 'Por el profesional');
    actualizarSol_(sol, { 'Estado': 'Finalización por confirmar', 'Mano de obra final (€)': mo, 'Materiales finales (€)': mat,
      'Trabajos adicionales': adic ? 'Sí' : 'No', 'Motivo cambio valor': s_(motivo, 500), 'Cierre iniciado por': iniciadoPor });
    iniciarAccion_(sol, 'cliente', 'confirmar_cierre');
    registrar_('Sistema', 'Profesional indica trabajo finalizado', oc, pro, 'MO final ' + euros_(mo) + (inicial !== null ? ' (inicial ' + euros_(inicial) + ')' : '') + (adic ? ' · con trabajos adicionales' : ''));
    return { ok: true, msg: 'Gracias. Hemos pedido al cliente que confirme el cierre.' };
  });
}

/** «EL TRABAJO TERMINÓ» (cliente): el profesional debe registrar el valor final; después el cliente confirma. */
function clienteTerminado_(oc) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Estado'] === 'Cierre pendiente del profesional') return { ok: true, ya: true, msg: 'Ya lo habías indicado. Estamos esperando al profesional.' };
    if (['Trabajo en proceso', 'Archivado por inactividad', 'Profesional asignado'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no aplica (estado: ' + sol['Estado'] + ').' };
    if (sol['Estado'] === 'Archivado por inactividad') registrar_('Sistema', 'Servicio reabierto', oc, sol['Profesional asignado (PRO)'], 'Por el cliente');
    actualizarSol_(sol, { 'Estado': 'Cierre pendiente del profesional', 'Cierre iniciado por': 'Cliente' });
    iniciarAccion_(sol, 'profesional', 'registrar_cierre');
    registrar_('Sistema', 'Cliente indica que el trabajo terminó', oc, sol['Profesional asignado (PRO)'], '');
    return { ok: true, msg: 'Gracias. Hemos pedido al profesional que registre el valor final para completar el cierre. Después te pediremos tu confirmación.' };
  });
}

/** Confirmación definitiva del CLIENTE: 'si' | 'aun_no' | 'problema'. La comisión SOLO nace con 'si'. */
function procesarFinCliente_(oc, decision, texto, grave, categoria) {
  if (decision === 'aun_no') return clienteSigueEnProceso_(oc);
  if (decision === 'problema') return reportarIncidencia_(oc, 'cliente', categoria || (grave ? 'Situación grave' : 'Otro'), texto);
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'], p = profesional_(pro);
    if (ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(sol['Estado']) >= 0) return { ok: true, ya: true, msg: 'Ya confirmaste el cierre. ¡Gracias!' };
    if (sol['Estado'] !== 'Finalización por confirmar') return { ok: false, msg: 'Ahora no hay ningún cierre pendiente de confirmar (estado: ' + sol['Estado'] + ').' };
    if (decision !== 'si') return { ok: false, msg: 'Opción no válida.' };
    var ahora = new Date();
    actualizarSol_(sol, { 'Finalizado (fecha)': ahora, 'Cliente confirmó fin (fecha)': ahora });
    pararAccion_(sol);
    registrar_('Sistema', 'Cliente confirma el cierre', oc, pro, 'MO final ' + euros_(sol['Mano de obra final (€)']));
    var c = crearObligacionComision_(sol, p, Number(sol['Mano de obra final (€)']));
    actualizarSol_(sol, { 'Estado': c && ESTADOS_COMISION_BLOQUEAN.indexOf(c.estado) >= 0 ? 'Comisión pendiente' : 'Cerrado', 'Comisión (€)': c ? c.importe : '' });
    return { ok: true, valorar: true, msg: '¡Gracias! El servicio queda cerrado. Si quieres, valóralo aquí mismo.' };
  });
}

/** Valoración 1–5: SOLO tras un cierre real confirmado (o resuelto por soporte como trabajo completo/parcial). */
function procesarValoracion_(oc, estrellas, comentario) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'];
    estrellas = parseInt(estrellas, 10);
    if (!(estrellas >= 1 && estrellas <= 5)) return { ok: false, msg: 'Elige de 1 a 5 estrellas.' };
    if (!sol['Cliente confirmó fin (fecha)'] || ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Solo se puede valorar un trabajo con cierre confirmado.' };
    var tv = tabla_('Valoraciones');
    if (tv.todas().some(function (v) { return v['Código OC'] === oc; })) return { ok: true, ya: true, msg: 'Ya habíamos recibido tu valoración. ¡Gracias!' };
    tv.agregar({ 'Fecha': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Estrellas': estrellas, 'Comentario': s_(comentario, 1000), 'Publicable': 'No', 'Trabajo verificado': 'Sí' });
    actualizarSol_(sol, { 'Valoración (1-5)': estrellas });
    var p = profesional_(pro);
    if (p) encolarCorreo_('pro-valoracion-' + oc, 'valoracion_pro', 'Profesional', p['Email'], oc, pro, { estrellas: estrellas, token: { tipo: 'gestion', dias: 180 } }, true);
    registrar_('Sistema', 'Valoración recibida', oc, pro, estrellas + '/5');
    recalcularMetricas_();
    return { ok: true, msg: '¡Gracias por tu valoración! Nos ayuda a mejorar.' };
  });
}

/* ---------- INCIDENCIAS (cliente o profesional) ---------- */

/** «HAY UN PROBLEMA / REPORTAR INCIDENCIA». Detiene cierre y cobro, no decide culpables, avisa a soporte al momento. */
function reportarIncidencia_(oc, quien, categoria, comentario) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'];
    var cat = CATEGORIAS_INCIDENCIA.indexOf(categoria) >= 0 ? categoria : 'Otro';
    if (!String(comentario || '').trim()) return { ok: false, msg: 'Cuéntanos brevemente qué ha pasado.' };
    var abiertas = tabla_('Incidencias').todas().filter(function (i) { return i['Código OC'] === oc && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); });
    if (abiertas.some(function (i) { return String(i['Descripción']) === s_(comentario, 1500); })) return { ok: true, ya: true, soporte: true, msg: 'Ya habíamos registrado esta incidencia. Soporte la está revisando.' };
    if (abiertas.length >= 5) return { ok: false, msg: 'Ya hay varias incidencias abiertas en este servicio. Soporte te escribirá.' };
    var id = crearIncidencia_({ tipo: 'Incidencia', oc: oc, pro: pro, origen: quien === 'profesional' ? 'Profesional' : 'Cliente', categoria: cat,
      grave: cat === 'Situación grave', texto: comentario, sol: sol, quien: quien });
    // El servicio queda EN REVISIÓN: se detienen el cierre automático, los recordatorios y el cobro automático
    if (sol['Estado'] !== 'En revisión' && sol['Estado'] !== 'Cancelada') {
      actualizarSol_(sol, { 'Estado previo': sol['Estado'], 'Estado': 'En revisión', 'Requiere intervención': 'Incidencia ' + id });
      pararAccion_(sol);
    }
    var c = comisionDeOC_(oc);
    if (c && ['DUE', 'PAYMENT_FAILED', 'NO_HABILITADA'].indexOf(c['Estado']) >= 0) tabla_('Comisiones').poner(c._fila, { 'Estado': 'EN_REVISION', 'Notas': 'Congelada por la incidencia ' + id });
    // Aviso corto a la otra parte (no se decide quién tiene razón)
    var otra = quien === 'profesional' ? sol['Email'] : (profesional_(pro) || {})['Email'];
    if (emailOk_(otra)) encolarCorreo_('inc-parte-' + id, 'incidencia_parte', quien === 'profesional' ? 'Cliente' : 'Profesional', otra, oc, quien === 'profesional' ? '' : pro,
      quien === 'profesional' ? {} : { token: { tipo: 'gestion', dias: 180 } }, true);
    return { ok: true, soporte: true, msg: 'Hemos registrado la incidencia ' + id + '. El servicio queda en revisión y soporte ya está avisado. Si lo necesitas, escríbenos por WhatsApp.' };
  });
}

/** Mensaje general del cliente (ayuda) o sugerencia: no cambia el estado del servicio. */
function procesarComentarioCliente_(oc, tipo, categoria, texto, grave) {
  if (tipo !== 'sugerencia' && tipo !== 'ayuda') return reportarIncidencia_(oc, 'cliente', categoria, texto);
  return conLock_(function () {
    var previas = tabla_('Incidencias').todas().filter(function (i) { return i['Código OC'] === oc && /^Cliente/.test(i['Origen']); });
    if (previas.length >= 5) return { ok: false, msg: 'Ya hemos recibido varios mensajes sobre esta solicitud. Te escribiremos pronto.' };
    if (previas.some(function (i) { return String(i['Descripción']) === s_(texto, 1500); })) return { ok: true, ya: true, msg: 'Ya habíamos recibido este mensaje. ¡Gracias!' };
    var sug = tipo === 'sugerencia';
    crearIncidencia_({ tipo: sug ? 'Sugerencia' : 'Ayuda', oc: oc, pro: '', origen: sug ? 'Cliente (sugerencia)' : 'Cliente (pide ayuda)', categoria: 'Otro', grave: !!grave, texto: texto, sol: solicitud_(oc), quien: 'cliente' });
    return { ok: true, msg: sug ? '¡Gracias por tu sugerencia!' : 'Hemos recibido tu mensaje. Una persona de OficioCerca te escribirá.' };
  });
}

function crearIncidencia_(o) {
  var id = siguienteCodigo_('SEQ_INC', 'INC-');
  var esSug = o.tipo === 'Sugerencia', sol = o.sol || (o.oc ? solicitud_(o.oc) : null);
  var prioridad = o.grave ? 'Grave' : ['Daños', 'Trabajo abandonado', 'Desacuerdo económico'].indexOf(o.categoria) >= 0 ? 'Alta' : 'Normal';
  tabla_('Incidencias').agregar({ 'ID': id, 'Fecha': new Date(), 'Tipo': o.tipo, 'Código OC': o.oc || '', 'Código PRO': o.pro || '', 'Origen': o.origen,
    'Categoría': o.categoria, 'Gravedad': prioridad, 'Descripción': s_(o.texto, 1500), 'Estado': esSug ? 'Cerrada' : 'Abierta',
    'Pausa preventiva': false, 'Notas': esSug ? 'Sugerencia: no cuenta como incidencia del profesional.' : '',
    'Servicio': sol ? servicioTxt_(sol) : '', 'Cliente': sol ? sol['Nombre'] : '', 'Reportado por': o.quien === 'profesional' ? 'Profesional' : 'Cliente',
    'Estado previo servicio': sol ? sol['Estado'] : '' });
  var fila = hoja_('Incidencias').getLastRow();
  hoja_('Incidencias').getRange(fila, tabla_('Incidencias').col('Pausa preventiva')).insertCheckboxes();
  registrar_('Sistema', esSug ? 'Sugerencia recibida' : 'Incidencia creada (' + prioridad + ')', o.oc, o.pro, id + ' · ' + o.categoria);
  if (!esSug) {
    var admin = cfg_('ADMIN_EMAIL');
    if (emailOk_(admin)) encolarCorreo_('admin-inc-' + id, 'incidencia_admin', 'Administrador', admin, o.oc || '', o.pro || '',
      { id: id, categoria: o.categoria, prioridad: prioridad, quien: o.origen, texto: s_(o.texto, 600) });
  }
  return id;
}

/**
 * Resolución MANUAL de una incidencia (columna «Resultado» de la pestaña Incidencias; la llama alEditar).
 *  - TRABAJO COMPLETO: comisión sobre la mano de obra final (o «Mano de obra reconocida (€)» si se rellena) → cierre.
 *  - TRABAJO PARCIAL: comisión SOLO sobre «Mano de obra reconocida (€)» (obligatoria) → cierre.
 *  - NO HUBO TRABAJO: comisión 0 → servicio cancelado.
 *  - SIN ACUERDO: no se genera comisión; sigue en revisión manual.
 *  - OTRO: se cierra la incidencia y el servicio vuelve a su estado anterior (se reanuda el seguimiento).
 */
function resolverIncidencia_(id, resultado, usuario) {
  var ti = tabla_('Incidencias'), inc = ti.buscar('ID', id);
  if (!inc) return 'Incidencia no encontrada';
  var oc = inc['Código OC'];
  if (!oc) return 'Sin solicitud asociada';
  var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'], p = profesional_(pro), ahora = new Date();
  var reconocida = String(inc['Mano de obra reconocida (€)']).trim() === '' ? NaN : num_(inc['Mano de obra reconocida (€)']);
  var c = comisionDeOC_(oc), out = '';
  var cerrarCon = function (mo) {
    if (c && c['Estado'] !== 'PAID') tabla_('Comisiones').poner(c._fila, { 'Estado': 'ANULADA', 'Notas': 'Sustituida por la resolución de ' + id });
    actualizarSol_(sol, { 'Mano de obra final (€)': mo, 'Finalizado (fecha)': sol['Finalizado (fecha)'] || ahora, 'Cliente confirmó fin (fecha)': sol['Cliente confirmó fin (fecha)'] || ahora });
    var nueva = crearObligacionComision_(sol, p, mo, true);
    actualizarSol_(sol, { 'Estado': nueva && ESTADOS_COMISION_BLOQUEAN.indexOf(nueva.estado) >= 0 ? 'Comisión pendiente' : 'Cerrado', 'Comisión (€)': nueva ? nueva.importe : '', 'Requiere intervención': '' });
    return 'comisión ' + euros_(nueva ? nueva.importe : 0) + ' sobre ' + euros_(mo);
  };
  if (resultado === 'RESUELTO — TRABAJO COMPLETO') {
    var mo = !isNaN(reconocida) && reconocida > 0 ? reconocida : Number(sol['Mano de obra final (€)']) || Number(sol['Mano de obra inicial (€)']) || 0;
    if (!(mo > 0)) return 'Falta la mano de obra: rellena «Mano de obra reconocida (€)»';
    out = 'Trabajo completo · ' + cerrarCon(mo);
  } else if (resultado === 'RESUELTO — TRABAJO PARCIAL') {
    if (!(reconocida > 0)) return 'Para trabajo parcial rellena antes «Mano de obra reconocida (€)»';
    out = 'Trabajo parcial · ' + cerrarCon(reconocida);
  } else if (resultado === 'CANCELADO — NO HUBO TRABAJO') {
    if (c && c['Estado'] !== 'PAID') tabla_('Comisiones').poner(c._fila, { 'Estado': 'ANULADA', 'Notas': 'No hubo trabajo (' + id + ')' });
    actualizarSol_(sol, { 'Estado': 'Cancelada', 'Motivo cierre': 'No hubo trabajo (' + id + ')', 'Requiere intervención': '' });
    out = 'Cancelado · comisión 0';
  } else if (resultado === 'SIN ACUERDO / REVISIÓN MANUAL') {
    actualizarSol_(sol, { 'Estado': 'En revisión', 'Requiere intervención': 'Sin acuerdo: revisión manual (' + id + ')' });
    ti.poner(inc._fila, { 'Estado': 'En revisión', 'Administrador': usuario || '' });
    registrar_('Admin', 'Incidencia sin acuerdo: revisión manual', oc, pro, id, usuario);
    return 'Sin acuerdo: queda en revisión manual (sin comisión automática)';
  } else if (resultado === 'OTRO') {
    var previo = inc['Estado previo servicio'] && ESTADOS_SOLICITUD.indexOf(inc['Estado previo servicio']) >= 0 ? inc['Estado previo servicio'] : 'Trabajo en proceso';
    if (previo === 'En revisión') previo = 'Trabajo en proceso';
    if (c && c['Estado'] === 'EN_REVISION') tabla_('Comisiones').poner(c._fila, { 'Estado': c['Ambiente'] === 'NO_HABILITADO' ? 'NO_HABILITADA' : 'DUE', 'Notas': 'Reanudada tras ' + id });
    actualizarSol_(sol, { 'Estado': previo, 'Requiere intervención': '' });
    out = 'Seguimiento reanudado (' + previo + ')';
  } else return 'Resultado no válido';
  ti.poner(inc._fila, { 'Estado': 'Resuelta', 'Fecha resolución': ahora, 'Administrador': usuario || '', 'Acción tomada': out });
  registrar_('Admin', 'Incidencia resuelta: ' + resultado, oc, pro, id + ' · ' + out, usuario);
  [['Cliente', sol['Email'], ''], ['Profesional', p && p['Email'], pro]].forEach(function (d) {
    if (emailOk_(d[1])) encolarCorreo_('inc-res-' + id + '-' + d[0], 'incidencia_resuelta', d[0], d[1], oc, d[2], d[0] === 'Profesional' ? { resultado: resultado, token: { tipo: 'gestion', dias: 180 } } : { resultado: resultado }, true);
  });
  return out;
}

/** Métricas internas por profesional (derivadas: se recalculan desde los datos, sin desajustes). */
function recalcularMetricas_() {
  var tp = tabla_('Profesionales'), pros = tp.todas();
  if (!pros.length) return;
  var ofertas = tabla_('Ofertas').todas(), vals = tabla_('Valoraciones').todas(), incs = tabla_('Incidencias').todas();
  var sols = tabla_('Solicitudes').todas(), coms = tabla_('Comisiones').todas();
  var cols = ['Ofertas recibidas', 'Respuestas', 'Aceptadas', 'Asignaciones', 'Completados', 'Tiempo medio respuesta (h)', 'Valoración media',
    'Nº valoraciones', 'Incidencias verificadas', 'Comisiones pendientes', 'Última oferta'];
  var colsRep = ['Tasa respuesta (%)', 'Cumplimiento seguimiento (%)'];
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
      sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code && !!s['Cliente confirmó fin (fecha)'] && ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(s['Estado']) >= 0; }).length,
      tiempos.length ? Math.round(tiempos.reduce(function (a, b) { return a + b; }, 0) / tiempos.length * 10) / 10 : '',
      v.length ? Math.round(v.reduce(function (a, x) { return a + Number(x['Estrellas']); }, 0) / v.length * 10) / 10 : '',
      v.length,
      incs.filter(function (i) { return i['Código PRO'] === code && i['Tipo'] === 'Incidencia' && /Resuelta|Verificada/.test(i['Estado']) && /PARCIAL|NO HUBO/.test(String(i['Resultado'])); }).length,
      coms.filter(function (c) { return c['Código PRO'] === code && ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) >= 0; }).length,
      ultima ? new Date(ultima) : ''];
  });
  // Escritura por bloques contiguos (las filas pueden no ser consecutivas si hay huecos)
  pros.forEach(function (p, i) { tp.sh.getRange(p._fila, c0, 1, cols.length).setValues([valores[i]]); });
  // Reputación: tasa de respuesta a oportunidades y cumplimiento del seguimiento (servicios con acuerdo que NO acabaron
  // archivados ni escalados por inacción del profesional). Vacío si aún no hay datos (profesional nuevo = neutro).
  var c1 = tp.col(colsRep[0]);
  pros.forEach(function (p) {
    var code = p['Código'], of = ofertas.filter(function (o) { return o['Código PRO'] === code; });
    var cerradasOf = of.filter(function (o) { return o['Estado'] !== 'Enviada'; });
    var resp = cerradasOf.filter(function (o) { return /Puede|No puede/.test(o['Respuesta']); }).length;
    var trab = sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code && s['Fecha registro acuerdo']; });
    var malos = trab.filter(function (s) { return /profesional|ambos/.test(String(s['Escalado por'])); }).length;
    tp.sh.getRange(p._fila, c1, 1, 2).setValues([[cerradasOf.length ? Math.round(resp / cerradasOf.length * 100) : '', trab.length ? Math.round((1 - malos / trab.length) * 100) : '']]);
  });
  _tablas['Profesionales'] && (_tablas['Profesionales']._cache = null);
}
