/* ============================================================ PRESUPUESTO · COMISIÓN · FINALIZACIÓN · VALORACIÓN · INCIDENCIAS */

/* El «presupuesto» de V1.5 es ahora el ACUERDO (V1.6): mano de obra + materiales + fecha acordada + nota.
 * Cada registro o cambio = nueva versión (pestaña «Presupuestos»); nada se sobrescribe y cada cambio exige reconfirmación. */
var ESTADOS_PERMITEN_ACUERDO = ['Profesional asignado', 'Acuerdo pendiente del cliente', 'Acuerdo no confirmado', 'Acuerdo confirmado', 'Trabajo en proceso'];
var ESTADOS_PERMITEN_PRESUPUESTO = ESTADOS_PERMITEN_ACUERDO; // compatibilidad
var ESTADOS_TRAS_CONFIRMAR_FIN = ['Comisión pendiente', 'Cerrado'];

/** «Ya hablé con el cliente / Registrar acuerdo». fecha = 'AAAA-MM-DD' (opcional). */
function registrarAcuerdo_(oc, pro, manoObra, materiales, fecha, nota) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
    if (ESTADOS_PERMITEN_ACUERDO.indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no se puede registrar un acuerdo (estado: ' + sol['Estado'] + ').' };
    var mo = num_(manoObra), mat = materiales === '' || materiales === undefined || materiales === null ? 0 : num_(materiales);
    if (isNaN(mo) || mo < 0 || isNaN(mat) || mat < 0) return { ok: false, msg: 'Revisa los importes: usa números (por ejemplo 350 o 350,50).' };
    if (mo > 1000000 || mat > 1000000) return { ok: false, msg: 'Importe demasiado alto. Revisa las cifras.' };
    var total = Math.round((mo + mat) * 100) / 100;
    if (total <= 0) return { ok: false, msg: 'El total debe ser mayor que 0.' };
    var f = String(fecha || '').slice(0, 10);
    if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) return { ok: false, msg: 'Revisa la fecha acordada.' };
    var tp = tabla_('Presupuestos');
    var previos = tp.todas().filter(function (r) { return r['Código OC'] === oc; });
    var ultimo = previos[previos.length - 1];
    // Doble clic / recarga: mismo acuerdo en los últimos 10 minutos → no se duplica
    if (ultimo && Number(ultimo['Mano de obra (€)']) === mo && Number(ultimo['Materiales (€)']) === mat && String(ultimo['Observaciones']) === s_(nota, 1000) &&
      String(ultimo['Fecha acordada'] || '') === f && Date.now() - new Date(ultimo['Fecha']).getTime() < 10 * 60000)
      return { ok: true, ya: true, msg: 'Este acuerdo ya estaba registrado (versión ' + ultimo['Versión'] + ').' };
    var reconfirmar = ['Acuerdo confirmado', 'Trabajo en proceso'].indexOf(sol['Estado']) >= 0;
    previos.forEach(function (r) { if (r['Estado'] === 'Pendiente del cliente' || r['Estado'] === 'Enviado al cliente' || r['Estado'] === 'Confirmado' || r['Estado'] === 'Aceptado') tp.poner(r._fila, { 'Estado': 'Sustituido' }); });
    var version = previos.length + 1, id = 'P-' + oc + '-v' + version;
    tp.agregar({ 'ID': id, 'Fecha': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Versión': version, 'Mano de obra (€)': mo, 'Materiales (€)': mat,
      'Total (€)': total, 'Observaciones': s_(nota, 1000), 'Estado': 'Pendiente del cliente', 'Fecha acordada': f ? "'" + f : '', 'Registrado por': pro,
      'Política comisión': POLITICA_COMISION.version });
    actualizarSol_(sol, { 'Estado': 'Acuerdo pendiente del cliente', 'Presupuesto vigente': id, 'Versión acuerdo': version, 'Fecha acordada': f ? "'" + f : '' });
    encolarCorreo_('cli-acuerdo-' + id, 'acuerdo_cliente', 'Cliente', sol['Email'], oc, pro, { presupuesto: id, cambio: reconfirmar || version > 1 }, true);
    registrar_('Sistema', reconfirmar ? 'Acuerdo modificado (requiere reconfirmación)' : 'Acuerdo registrado', oc, pro,
      id + ' · MO ' + euros_(mo) + ' · materiales ' + euros_(mat) + (f ? ' · fecha ' + f : ''));
    return { ok: true, msg: 'Acuerdo registrado (versión ' + version + '). Hemos pedido al cliente que lo confirme.' };
  });
}
/** Compatibilidad V1.5. */
function registrarPresupuesto_(oc, pro, manoObra, materiales, obs, fecha) { return registrarAcuerdo_(oc, pro, manoObra, materiales, fecha || '', obs); }

/** Respuesta del CLIENTE al acuerdo: 'confirmar' | 'no_de_acuerdo' (+ alias V1.5 'aceptar' | 'rechazar'). */
function procesarRespuestaPresupuesto_(presId, decision) {
  if (decision === 'aceptar') decision = 'confirmar';
  if (decision === 'rechazar') decision = 'no_de_acuerdo';
  return conLock_(function () {
    var tp = tabla_('Presupuestos'), pr = tp.buscar('ID', presId);
    if (!pr) return { ok: false, msg: 'Acuerdo no encontrado.' };
    var sol = solicitud_(pr['Código OC']), oc = sol['Código'], pro = pr['Código PRO'];
    var p = profesional_(pro);
    if (pr['Estado'] === 'Confirmado' || pr['Estado'] === 'Aceptado') return { ok: true, ya: true, msg: 'Ya habías confirmado este acuerdo. ¡Gracias!' };
    if (pr['Estado'] === 'No confirmado' || pr['Estado'] === 'No aceptado') return { ok: true, ya: true, msg: 'Ya nos indicaste que no estás de acuerdo.' };
    if ((pr['Estado'] !== 'Pendiente del cliente' && pr['Estado'] !== 'Enviado al cliente') || sol['Presupuesto vigente'] !== presId)
      return { ok: false, msg: 'Este acuerdo fue sustituido por una versión más reciente. Abre tu seguimiento para ver la última.' };
    var ahora = new Date();
    if (decision === 'confirmar') {
      tp.poner(pr._fila, { 'Estado': 'Confirmado', 'Respuesta cliente (fecha)': ahora, 'Confirmado por': 'Cliente (' + sol['Email'] + ')' });
      var f = fechaIso_(pr['Fecha acordada']);
      var enCurso = f && f <= Utilities.formatDate(ahora, ZONA_HORARIA, 'yyyy-MM-dd');
      actualizarSol_(sol, { 'Estado': enCurso ? 'Trabajo en proceso' : 'Acuerdo confirmado', 'Mano de obra aceptada (€)': Number(pr['Mano de obra (€)']) || 0,
        'Materiales aceptados (€)': Number(pr['Materiales (€)']) || 0, 'Total aceptado (€)': Number(pr['Total (€)']), 'Fecha aceptación': ahora, 'Comisión (€)': '' });
      if (p) encolarCorreo_('pro-acuerdo-ok-' + presId, 'acuerdo_confirmado_pro', 'Profesional', p['Email'], oc, pro, { presupuesto: presId, token: { tipo: 'gestion', dias: 180 } }, true);
      registrar_('Sistema', 'Cliente confirma el acuerdo', oc, pro, presId + ' · MO ' + euros_(pr['Mano de obra (€)']) + ' · materiales ' + euros_(pr['Materiales (€)']));
      return { ok: true, msg: 'Has confirmado el acuerdo. El profesional ya está avisado. Cuando termine el trabajo te pediremos que lo confirmes.' };
    }
    if (decision === 'no_de_acuerdo') {
      tp.poner(pr._fila, { 'Estado': 'No confirmado', 'Respuesta cliente (fecha)': ahora });
      actualizarSol_(sol, { 'Estado': 'Acuerdo no confirmado' });
      if (p) encolarCorreo_('pro-acuerdo-no-' + presId, 'acuerdo_no_confirmado_pro', 'Profesional', p['Email'], oc, pro, { presupuesto: presId, token: { tipo: 'gestion', dias: 180 } }, true);
      registrar_('Sistema', 'Cliente NO está de acuerdo', oc, pro, presId);
      return { ok: true, msg: 'Hemos avisado al profesional de que no estás de acuerdo. Podéis hablarlo y, si llegáis a otro acuerdo, te pediremos que lo confirmes.' };
    }
    return { ok: false, msg: 'Opción no válida.' };
  });
}

/** El profesional indica «Trabajo terminado». No cierra nada: el cliente debe confirmarlo. */
function marcarFinalizado_(oc, pro) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
    if (sol['Estado'] === 'Finalización por confirmar') return { ok: true, ya: true, msg: 'Ya lo habías indicado. Estamos esperando la confirmación del cliente.' };
    if (['Acuerdo confirmado', 'Trabajo en proceso'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Solo se puede indicar «Trabajo terminado» con un acuerdo confirmado por el cliente (estado actual: ' + sol['Estado'] + ').' };
    var n = tabla_('Registro').todas().filter(function (r) { return r['Código OC'] === oc && r['Acción'] === 'Profesional indica trabajo finalizado'; }).length + 1;
    actualizarSol_(sol, { 'Estado': 'Finalización por confirmar' });
    encolarCorreo_('cli-fin-' + oc + '-' + n, 'fin_cliente', 'Cliente', sol['Email'], oc, pro, {}, true);
    registrar_('Sistema', 'Profesional indica trabajo finalizado', oc, pro, 'Aviso ' + n);
    return { ok: true, msg: 'Gracias. Hemos pedido al cliente que confirme que el trabajo terminó.' };
  });
}

/** Confirmación del cliente: 'si' | 'aun_no' | 'problema' (+ texto y gravedad). La comisión SOLO nace con 'si'. */
function procesarFinCliente_(oc, decision, texto, grave) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'], p = profesional_(pro);
    if (ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(sol['Estado']) >= 0) return { ok: true, ya: true, msg: 'Ya confirmaste que el trabajo terminó. ¡Gracias!' };
    if (sol['Estado'] !== 'Finalización por confirmar') return { ok: false, msg: 'Ahora no hay ninguna finalización pendiente de confirmar (estado: ' + sol['Estado'] + ').' };
    if (decision === 'si') {
      var ahora = new Date();
      actualizarSol_(sol, { 'Finalizado (fecha)': ahora, 'Cliente confirmó fin (fecha)': ahora });
      registrar_('Sistema', 'Cliente confirma finalización', oc, pro, '');
      var c = crearObligacionComision_(sol, p); // calcula, crea la obligación y arranca el cobro si procede
      actualizarSol_(sol, { 'Estado': c && ESTADOS_COMISION_BLOQUEAN.indexOf(c.estado) >= 0 ? 'Comisión pendiente' : 'Cerrado', 'Comisión (€)': c ? c.importe : '' });
      return { ok: true, valorar: true, msg: '¡Gracias! Hemos registrado que el trabajo terminó. Si quieres, valora el servicio aquí mismo.' };
    }
    if (decision === 'aun_no') {
      actualizarSol_(sol, { 'Estado': 'Trabajo en proceso' });
      if (p) encolarCorreo_('pro-aun-no-' + oc + '-' + Date.now(), 'aun_no_pro', 'Profesional', p['Email'], oc, pro, { token: { tipo: 'gestion', dias: 180 } }, true);
      registrar_('Sistema', 'Cliente indica que aún no ha terminado', oc, pro, 'Discrepancia con la finalización declarada por el profesional');
      return { ok: true, msg: 'Entendido. Avisamos al profesional. Cuando termine, te volveremos a preguntar.' };
    }
    if (decision === 'problema') {
      crearIncidencia_({ tipo: 'Incidencia', oc: oc, pro: pro, origen: 'Cliente (finalización)', categoria: 'Problema con el trabajo', grave: !!grave, texto: texto });
      return { ok: true, msg: 'Lo sentimos. Hemos registrado el problema y una persona de OficioCerca lo revisará y te escribirá. La comisión no se genera mientras tanto.' };
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
    if (!sol['Cliente confirmó fin (fecha)'] && ['Finalizado', 'Valorada'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Solo se puede valorar un trabajo finalizado.' };
    var tv = tabla_('Valoraciones');
    if (tv.todas().some(function (v) { return v['Código OC'] === oc; })) return { ok: true, ya: true, msg: 'Ya habíamos recibido tu valoración. ¡Gracias!' };
    tv.agregar({ 'Fecha': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Estrellas': estrellas, 'Comentario': s_(comentario, 1000), 'Publicable': 'No' });
    actualizarSol_(sol, { 'Valoración (1-5)': estrellas });
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
      sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code && !!s['Cliente confirmó fin (fecha)']; }).length,
      tiempos.length ? Math.round(tiempos.reduce(function (a, b) { return a + b; }, 0) / tiempos.length * 10) / 10 : '',
      v.length ? Math.round(v.reduce(function (a, x) { return a + Number(x['Estrellas']); }, 0) / v.length * 10) / 10 : '',
      v.length,
      incs.filter(function (i) { return i['Código PRO'] === code && i['Tipo'] === 'Incidencia' && i['Estado'] === 'Verificada'; }).length,
      coms.filter(function (c) { return c['Código PRO'] === code && ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) >= 0; }).length,
      ultima ? new Date(ultima) : ''];
  });
  // Escritura por bloques contiguos (las filas pueden no ser consecutivas si hay huecos)
  pros.forEach(function (p, i) { tp.sh.getRange(p._fila, c0, 1, cols.length).setValues([valores[i]]); });
}
