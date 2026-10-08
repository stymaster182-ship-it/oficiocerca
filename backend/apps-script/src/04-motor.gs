/* ============================================================ MOTOR DE MATCHING (reglas deterministas, sin IA)
 *
 * FILTROS DUROS (todos obligatorios):
 *  1. Profesional «Activo» (no Pendiente, En revisión, Pausado ni Baja) y con correo válido.
 *  2. El servicio pedido está entre SUS servicios declarados (códigos normalizados).
 *  3. Condiciones para profesionales aceptadas (versión registrada).
 *  4. Zona/distancia compatibles con Córdoba capital:
 *       - ciudad Córdoba: sirve, salvo «Solo mi barrio o pueblo» sin coincidencia de zona/CP;
 *       - otra localidad de la provincia (CP 14…): solo si se desplaza «Hasta 25 km» o más.
 *  5. Atiende ese tipo de cliente (particulares / empresas).
 *  6. No ha recibido ya esta solicitud.
 * ORDEN (explicable, se guarda en «Motivo ranking»):
 *  +3 su zona menciona el barrio o el CP del cliente · +2 su disponibilidad habitual encaja con el plazo
 *  +1 valoración media ≥ 4 · −2 por incidencia verificada · −3 prioridad «Baja»
 *  desempate: menos ofertas en 30 días (rotación justa) → oferta más antigua → alta más antigua.
 * Ofertas SECUENCIALES: una oferta activa por solicitud, nunca envíos masivos.
 */

var ESTADOS_BUSQUEDA = ['Nueva', 'Buscando profesional', 'Esperando respuesta profesional', 'Sin profesional disponible'];

function solicitud_(oc) {
  var r = tabla_('Solicitudes').buscar('Código', oc);
  if (!r) throw new Error('No existe ' + oc);
  return r;
}
function profesional_(pro) { return tabla_('Profesionales').buscar('Código', String(pro || '').trim().toUpperCase()); }
function actualizarSol_(sol, cambios) {
  cambios['Última actualización'] = new Date();
  tabla_('Solicitudes').poner(sol._fila, cambios);
  Object.keys(cambios).forEach(function (k) { sol[k] = cambios[k]; });
}

/** Avanza la búsqueda de una solicitud. Seguro de llamar varias veces (idempotente). */
function motor_(oc) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (ESTADOS_BUSQUEDA.indexOf(sol['Estado']) < 0) return 'sin búsqueda (' + sol['Estado'] + ')';
    if (SERVICIOS_ACTIVOS.indexOf(sol['Servicio (código)']) < 0) {
      actualizarSol_(sol, { 'Estado': 'Revisión manual', 'Requiere intervención': sol['Servicio (código)'] === 'otro' ? 'Otro servicio: revisar demanda' : 'Servicio no activo en el piloto: revisar' });
      return 'manual';
    }
    var ronda = rondaDe_(sol);
    var ofertas = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === oc && (Number(o['Ronda']) || 1) === ronda; });
    var activa = ofertas.filter(function (o) { return o['Estado'] === 'Enviada'; })[0];
    if (activa) return 'esperando ' + activa['Código PRO'];

    var cand = candidatos_(sol, ofertas);
    if (cand.length) {
      ofrecer_(sol, cand[0]);
      return 'ofrecida a ' + cand[0].pro['Código'];
    }
    // Sin más candidatos
    var respaldo = mejorRespaldo_(ofertas);
    if (respaldo && sol['Decisión cliente'] !== 'Seguir buscando') {
      if (sol['Estado'] !== 'Esperando decisión cliente') {
        actualizarSol_(sol, { 'Estado': 'Esperando decisión cliente', 'Requiere intervención': '', 'Respaldo (PRO)': respaldo['Código PRO'], 'Respaldo disponibilidad': respaldo['Disponibilidad'] });
        encolarCorreo_('cli-respaldo-' + oc + '-' + respaldo['Código PRO'], 'respaldo_cliente', 'Cliente', sol['Email'], oc, respaldo['Código PRO'],
          { token: { tipo: 'respaldo', ref: respaldo['ID'], dias: 7 } });
        registrar_('Sistema', 'Cliente debe decidir sobre disponibilidad posterior', oc, respaldo['Código PRO'], respaldo['Disponibilidad']);
      }
      return 'respaldo ' + respaldo['Código PRO'];
    }
    if (sol['Estado'] !== 'Sin profesional disponible') {
      actualizarSol_(sol, { 'Estado': 'Sin profesional disponible', 'Requiere intervención': 'No hay profesional compatible disponible' + (respaldo ? ' (el cliente pidió seguir buscando)' : '') });
      registrar_('Sistema', 'Sin profesional disponible', oc, '', SERVICIOS[sol['Servicio (código)']] + ' · ' + sol['Zona'] + ' · ronda ' + ronda);
      // UN solo correo por ronda de búsqueda (la clave lo hace idempotente); se sigue reintentando en silencio
      encolarCorreo_('cli-sinpro-' + oc + '-r' + ronda, 'sin_profesional', 'Cliente', sol['Email'], oc, '', {}, true);
    }
    return 'sin candidatos';
  });
}

function candidatos_(sol, ofertasOC) {
  var servicio = sol['Servicio (código)'];
  var yaOfrecidos = ofertasOC.map(function (o) { return String(o['Código PRO']); });
  var empresa = /empresa|contratista/i.test(sol['Tipo solicitante']); // Empresa y Contratista = cliente B2B
  var dCli = diasCliente_(sol);
  var hace30 = Date.now() - 30 * 86400000;
  var todasOfertas = tabla_('Ofertas').todas();
  var bloqueados = prosBloqueados_(); // comisión exigible sin pagar → sin NUEVAS oportunidades (trabajos actuales intactos)
  var out = [];
  tabla_('Profesionales').todas().forEach(function (p) {
    var code = String(p['Código']);
    if (String(p['Estado']).trim() !== 'Activo') return;
    if (!emailOk_(p['Email'])) return;
    if (listaServicios_(p['Servicios (códigos)']).indexOf(servicio) < 0) return;
    if (!condAlDia_(p)) return; // V1.6: debe haber aceptado la versión VIGENTE de las condiciones
    if (empresa ? p['Con empresas'] !== 'Sí' : p['Con particulares'] !== 'Sí') return;
    if (yaOfrecidos.indexOf(code) >= 0) return;
    if (bloqueados[code]) return;
    var zona = zonaCompatible_(p, sol);
    if (!zona.ok) return;
    var puntos = 0, motivos = [];
    if (zona.coincide) { puntos += 3; motivos.push('zona +3'); }
    var habitual = sinAcentos_(p['Disponibilidad habitual']);
    if (dCli !== null && dCli <= 7 && /esta semana/.test(habitual)) { puntos += 2; motivos.push('disponibilidad habitual +2'); }
    if (dCli !== null && dCli > 7 && /1-2 semanas|1–2 semanas/.test(habitual)) { puntos += 1; motivos.push('disponibilidad habitual +1'); }
    if (dCli === null && !/completa/.test(habitual)) { puntos += 1; motivos.push('plazo flexible +1'); }
    var rep = puntosReputacion_(p);
    if (rep.puntos) { puntos += rep.puntos; motivos.push(rep.motivo); }
    if (p['Prioridad'] === 'Baja') { puntos -= 3; motivos.push('prioridad baja −3'); }
    var recientes = todasOfertas.filter(function (o) { return o['Código PRO'] === code && new Date(o['Fecha envío']).getTime() > hace30; });
    var ultima = recientes.reduce(function (m, o) { return Math.max(m, new Date(o['Fecha envío']).getTime()); }, 0);
    motivos.push(recientes.length + ' oferta(s)/30 días');
    out.push({ pro: p, puntos: puntos, recientes: recientes.length, ultima: ultima, alta: new Date(p['Fecha']).getTime(), motivo: motivos.join(' · ') });
  });
  out.sort(function (a, b) { return b.puntos - a.puntos || a.recientes - b.recientes || a.ultima - b.ultima || a.alta - b.alta; });
  return out;
}

function zonaCompatible_(p, sol) {
  var ciudad = sinAcentos_(p['Ciudad']), dist = sinAcentos_(p['Distancia']);
  var zonasPro = sinAcentos_(p['Zonas']), zonaCli = sinAcentos_(sol['Zona']), cpCli = limpio_(sol['Código postal']);
  var coincide = (zonaCli.length >= 3 && zonasPro.indexOf(zonaCli) >= 0) || (cpCli && zonasPro.indexOf(cpCli) >= 0) || (cpCli && cpCli === limpio_(p['Código postal']));
  var enCordoba = /(^|\b)cordoba(\b|$)/.test(ciudad) && !/provincia/.test(ciudad);
  if (enCordoba) {
    if (/solo mi barrio/.test(dist) && !coincide) return { ok: false };
    return { ok: true, coincide: coincide };
  }
  var cpPro = limpio_(p['Código postal']);
  if (/^14/.test(cpPro) && /(25|50) km|provincia/.test(dist)) return { ok: true, coincide: coincide };
  return { ok: false };
}

function plazoRespuestaHoras_(sol) {
  var d = diasCliente_(sol);
  return (d !== null && d <= 1) ? cfgNum_('HORAS_RESPUESTA_URGENTE', 4) : cfgNum_('HORAS_RESPUESTA_NORMAL', 24);
}
/** Vencimiento evitando la noche: si cae entre 21:00 y 9:00 se pasa a las 10:00. */
function vencimiento_(horas) {
  var d = new Date(Date.now() + horas * 3600000);
  var h = Number(Utilities.formatDate(d, ZONA_HORARIA, 'H'));
  if (h >= 21) d = new Date(d.getTime() + (24 - h + 10) * 3600000);
  else if (h < 9) d = new Date(d.getTime() + (10 - h) * 3600000);
  return d;
}

function ofrecer_(sol, c) {
  var oc = sol['Código'], p = c.pro, pro = p['Código'];
  var id = 'OF-' + oc + '-' + pro;
  var expira = vencimiento_(plazoRespuestaHoras_(sol));
  tabla_('Ofertas').agregar({
    'ID': id, 'Fecha envío': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Profesional': p['Nombre'],
    'Servicio': SERVICIOS[sol['Servicio (código)']] || sol['Servicio'], 'Puntuación': c.puntos, 'Motivo ranking': c.motivo,
    'Estado': 'Enviada', 'Expira': expira, 'Ronda': rondaDe_(sol)
  });
  actualizarSol_(sol, { 'Estado': 'Esperando respuesta profesional', 'Requiere intervención': '' });
  encolarCorreo_('pro-oferta-' + id, 'oferta_profesional', 'Profesional', p['Email'], oc, pro,
    { token: { tipo: 'oferta', ref: id, expira: expira.getTime() }, expira: expira.getTime() });
  registrar_('Sistema', 'Oportunidad enviada', oc, pro, c.motivo + ' · responde antes de ' + fecha_(expira));
}

/** Mejor respaldo = el que puede antes (menos días). */
function mejorRespaldo_(ofertasOC) {
  var r = ofertasOC.filter(function (o) { return o['Estado'] === 'Respaldo'; })
    .filter(function (o) { var p = profesional_(o['Código PRO']); return p && p['Estado'] === 'Activo'; });
  r.sort(function (a, b) { return Number(a['Días hasta disponibilidad']) - Number(b['Días hasta disponibilidad']); });
  return r[0] || null;
}

/**
 * Respuesta del profesional a una oportunidad (desde la página del enlace).
 * tipo: 'si' (disp = código DISP_PRO), 'mas_adelante' (fecha), 'no'.
 */
function procesarRespuestaOferta_(ofertaId, tipo, disp, fecha, nota) {
  return conLock_(function () {
    var to = tabla_('Ofertas'), of = to.buscar('ID', ofertaId);
    if (!of) return { ok: false, msg: 'Oportunidad no encontrada.' };
    if (of['Estado'] !== 'Enviada') return { ok: true, ya: true, msg: 'Ya habíamos registrado tu respuesta. ¡Gracias!' };
    var sol = solicitud_(of['Código OC']);
    if (['Esperando respuesta profesional', 'Buscando profesional'].indexOf(sol['Estado']) < 0) {
      to.poner(of._fila, { 'Estado': 'Cerrada', 'Fecha respuesta': new Date(), 'Notas': 'Respuesta tras cierre de la búsqueda' });
      return { ok: true, msg: 'Gracias. Esta solicitud ya no necesita profesional.' };
    }
    var ahora = new Date();
    if (tipo === 'no') {
      to.poner(of._fila, { 'Estado': 'Rechazada', 'Respuesta': 'No puede / no le interesa', 'Fecha respuesta': ahora, 'Notas': s_(nota, 300) });
      registrar_('Sistema', 'Profesional rechaza', sol['Código'], of['Código PRO'], s_(nota, 200));
      motor_(sol['Código']);
      return { ok: true, msg: 'Gracias por responder. Te enviaremos otras oportunidades compatibles.' };
    }
    var dias, dispCod, dispTxt;
    if (tipo === 'si' && DISP_PRO[disp] && disp !== 'OTRA_FECHA') { dispCod = disp; dias = DISP_PRO[disp].d; dispTxt = DISP_PRO[disp].t; }
    else {
      dias = diasHasta_(fecha);
      if (dias === null) return { ok: false, msg: 'Indica una fecha aproximada válida.' };
      dispCod = 'OTRA_FECHA'; dispTxt = 'A partir del ' + String(fecha).slice(8, 10) + '/' + String(fecha).slice(5, 7) + '/' + String(fecha).slice(0, 4);
    }
    var dCli = diasCliente_(sol);
    var encaja = dCli === null || dias <= dCli;
    to.poner(of._fila, {
      'Estado': encaja ? 'Seleccionada' : 'Respaldo', 'Respuesta': tipo === 'si' ? 'Puede atenderlo' : 'Puede, más adelante',
      'Disponibilidad (código)': dispCod, 'Disponibilidad': dispTxt, 'Días hasta disponibilidad': dias, 'Fecha respuesta': ahora, 'Notas': s_(nota, 300)
    });
    if (encaja) {
      asignar_(sol, of['Código PRO'], dispTxt, 'Plazo compatible');
      return { ok: true, msg: '¡Gracias! Te asignamos la solicitud. En unos minutos recibirás un correo con los datos de contacto del cliente.' };
    }
    registrar_('Sistema', 'Candidato de respaldo (plazo posterior)', sol['Código'], of['Código PRO'], dispTxt + ' · cliente: ' + sol['Plazo']);
    motor_(sol['Código']);
    return { ok: true, msg: 'Gracias. El cliente pidió un plazo más corto: guardamos tu disponibilidad como opción y te avisaremos si la solicitud es para ti.' };
  });
}

/** Asigna, cierra las demás ofertas y comparte el contacto SOLO con el asignado. Idempotente. */
function asignar_(sol, pro, dispTxt, motivo) {
  var oc = sol['Código'];
  if (sol['Profesional asignado (PRO)']) return false;
  var p = profesional_(pro);
  if (!p || p['Estado'] !== 'Activo') throw new Error(pro + ' no está activo');
  var to = tabla_('Ofertas');
  to.todas().filter(function (o) { return o['Código OC'] === oc; }).forEach(function (o) {
    if (o['Código PRO'] === pro) { if (o['Estado'] !== 'Seleccionada') to.poner(o._fila, { 'Estado': 'Seleccionada' }); return; }
    if (o['Estado'] === 'Enviada') to.poner(o._fila, { 'Estado': 'Cerrada', 'Notas': 'Solicitud asignada a otro profesional' });
    if (o['Estado'] === 'Respaldo') {
      to.poner(o._fila, { 'Estado': 'Cerrada', 'Notas': 'Se encontró disponibilidad antes' });
    }
  });
  actualizarSol_(sol, { 'Estado': 'Profesional asignado', 'Requiere intervención': '', 'Profesional asignado (PRO)': pro, 'Fecha asignación': new Date(), 'Disponibilidad profesional': dispTxt });
  encolarCorreo_('pro-contacto-' + oc + '-' + pro, 'contacto_profesional', 'Profesional', p['Email'], oc, pro, { token: { tipo: 'gestion', dias: 180 } });
  encolarCorreo_('cli-asignado-' + oc + '-' + pro, 'asignado_cliente', 'Cliente', sol['Email'], oc, pro, { disp: dispTxt });
  actualizarSol_(sol, { 'Contacto enviado (fecha)': new Date() });
  registrar_('Sistema', 'Asignación automática y contacto compartido', oc, pro, motivo + ' · ' + dispTxt);
  return true;
}

/** Decisión del cliente cuando solo hay disponibilidad posterior. */
function procesarDecisionRespaldo_(ofertaId, decision) {
  return conLock_(function () {
    var of = tabla_('Ofertas').buscar('ID', ofertaId);
    if (!of) return { ok: false, msg: 'Enlace no válido.' };
    var sol = solicitud_(of['Código OC']);
    if (sol['Estado'] !== 'Esperando decisión cliente') return { ok: true, ya: true, msg: 'Ya habíamos registrado tu decisión. Estado actual: ' + sol['Estado'] + '.' };
    if (decision === 'continuar') {
      if (of['Estado'] !== 'Respaldo') return { ok: false, msg: 'Esa disponibilidad ya no está vigente. Seguimos buscando.' };
      var p = profesional_(of['Código PRO']);
      if (!p || p['Estado'] !== 'Activo') { actualizarSol_(sol, { 'Estado': 'Buscando profesional' }); motor_(sol['Código']); return { ok: true, msg: 'Ese profesional ya no está disponible. Seguimos buscando y te escribiremos.' }; }
      actualizarSol_(sol, { 'Decisión cliente': 'Continuar con respaldo (' + fecha_(new Date()) + ')' });
      tabla_('Ofertas').poner(of._fila, { 'Estado': 'Seleccionada', 'Notas': 'Aceptado por el cliente con plazo posterior' });
      asignar_(sol, of['Código PRO'], of['Disponibilidad'], 'El cliente aceptó la disponibilidad posterior');
      return { ok: true, msg: 'Perfecto. Hemos asignado tu solicitud a ese profesional: te enviamos un correo con sus datos y él te contactará.' };
    }
    if (decision === 'seguir') {
      actualizarSol_(sol, { 'Estado': 'Buscando profesional', 'Decisión cliente': 'Seguir buscando', 'Requiere intervención': '' });
      registrar_('Sistema', 'Cliente pide seguir buscando', sol['Código'], of['Código PRO'], '');
      motor_(sol['Código']);
      return { ok: true, msg: 'De acuerdo, seguimos buscando. Conservamos la opción anterior por si la necesitas.' };
    }
    if (decision === 'cancelar') {
      cancelarSolicitud_(sol, 'Cancelada por el cliente (plazo no encaja)');
      return { ok: true, msg: 'Hemos cancelado tu solicitud. Gracias por confiar en OficioCerca.' };
    }
    return { ok: false, msg: 'Opción no válida.' };
  });
}

function cancelarSolicitud_(sol, motivo) {
  var to = tabla_('Ofertas');
  to.todas().filter(function (o) { return o['Código OC'] === sol['Código'] && (o['Estado'] === 'Enviada' || o['Estado'] === 'Respaldo'); })
    .forEach(function (o) { to.poner(o._fila, { 'Estado': 'Cerrada', 'Notas': 'Solicitud cancelada' }); });
  actualizarSol_(sol, { 'Estado': 'Cancelada', 'Motivo cierre': motivo, 'Requiere intervención': '' });
  registrar_('Sistema', 'Solicitud cancelada', sol['Código'], '', motivo);
}

/** Vencimientos y reintentos (lo llama el ciclo automático). */
function revisarOfertas_() {
  var ahora = Date.now(), tocadas = {};
  var to = tabla_('Ofertas');
  to.todas().forEach(function (o) {
    if (o['Estado'] !== 'Enviada') return;
    var p = profesional_(o['Código PRO']);
    if (!p || p['Estado'] !== 'Activo') { to.poner(o._fila, { 'Estado': 'Cerrada', 'Notas': 'Profesional ya no activo' }); tocadas[o['Código OC']] = 1; return; }
    if (o['Expira'] && new Date(o['Expira']).getTime() < ahora) {
      to.poner(o._fila, { 'Estado': 'Sin respuesta', 'Respuesta': 'Sin respuesta en plazo', 'Notas': 'Venció ' + fecha_(o['Expira']) });
      registrar_('Sistema', 'Oferta sin respuesta (vencida)', o['Código OC'], o['Código PRO'], '');
      tocadas[o['Código OC']] = 1;
    }
  });
  tabla_('Solicitudes').todas().forEach(function (s) {
    if (['Nueva', 'Buscando profesional', 'Sin profesional disponible'].indexOf(s['Estado']) >= 0) tocadas[s['Código']] = 1;
  });
  Object.keys(tocadas).forEach(function (oc) { try { motor_(oc); } catch (e) { errorSistema_('motor ' + oc, e); } });
}

/** Oferta manual del administrador (columna «Ofrecer a (PRO manual)»), p. ej. para «Otro servicio». */
function ofertaManual_(sol, pro) {
  pro = String(pro || '').trim().toUpperCase();
  var p = profesional_(pro);
  if (!p) return 'No existe ' + pro;
  if (p['Estado'] !== 'Activo') return pro + ' no está Activo';
  if (!condAlDia_(p)) return pro + ' no ha aceptado las condiciones vigentes (' + condVigente_() + ')';
  if (proBloqueado_(pro)) return pro + ' tiene una comisión exigible pendiente: no recibe nuevas oportunidades';
  var ofertas = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === sol['Código']; });
  if (ofertas.some(function (o) { return o['Estado'] === 'Enviada'; })) return 'Ya hay una oferta pendiente de respuesta';
  if (ofertas.some(function (o) { return o['Código PRO'] === pro; })) return pro + ' ya recibió esta solicitud';
  if (ESTADOS_BUSQUEDA.concat(['Revisión manual', 'Esperando decisión cliente']).indexOf(sol['Estado']) < 0) return 'La solicitud está «' + sol['Estado'] + '»';
  ofrecer_(sol, { pro: p, puntos: '', motivo: 'Oferta manual del administrador' });
  return 'Oferta enviada a ' + pro;
}

/** Ronda de búsqueda vigente (cada «Volver a buscar» abre una ronda nueva sin pedir otra vez los datos). */
function rondaDe_(sol) { return Number(sol['Ronda búsqueda']) || 1; }

/**
 * Reputación como SEÑAL SECUNDARIA de prioridad (los filtros duros —servicio, zona, tipo de cliente, estado activo,
 * condiciones vigentes y ausencia de bloqueo— se aplican antes). Pesos configurables (REP_PESO_*; 0 = no influye).
 * Un profesional nuevo sin datos puntúa 0 (neutro) y la rotación (menos ofertas en 30 días primero) le da oportunidades.
 *  - Valoración: solo con ≥ 1 valoración → (media − 3) / 2  (de −1 a +1).
 *  - Respuesta: solo con ≥ 3 ofertas → +1 si responde ≥ 80 %, −1 si responde < 40 %.
 *  - Seguimiento: solo con ≥ 2 trabajos → +0,5 si ≥ 90 % al día, −1 si < 60 %.
 *  - Nuevo (menos de 3 oportunidades recibidas): +1, para que entre en rotación sin necesitar reseñas.
 *  - Tope total ±1 (la zona coincidente suma 3): la reputación desempata, nunca domina.
 */
function puntosReputacion_(p) {
  var w1 = cfgNum_('REP_PESO_VALORACION', 1), w2 = cfgNum_('REP_PESO_RESPUESTA', 1), w3 = cfgNum_('REP_PESO_SEGUIMIENTO', 1);
  var pts = 0, m = [];
  var nv = Number(p['Nº valoraciones']) || 0, media = Number(p['Valoración media']) || 0;
  if (nv >= 1 && w1) { var a = w1 * (media - 3) / 2; pts += a; m.push('valoración ' + (a >= 0 ? '+' : '') + Math.round(a * 10) / 10); }
  var of = Number(p['Ofertas recibidas']) || 0, tr = p['Tasa respuesta (%)'];
  if (of >= 3 && tr !== '' && tr !== undefined && w2) { var b = Number(tr) >= 80 ? w2 : Number(tr) < 40 ? -w2 : 0; if (b) { pts += b; m.push('respuesta ' + (b > 0 ? '+' : '') + b); } }
  var cs = p['Cumplimiento seguimiento (%)'], tj = Number(p['Asignaciones']) || 0;
  if (tj >= 2 && cs !== '' && cs !== undefined && w3) { var c = Number(cs) >= 90 ? 0.5 * w3 : Number(cs) < 60 ? -w3 : 0; if (c) { pts += c; m.push('seguimiento ' + (c > 0 ? '+' : '') + c); } }
  // Profesional nuevo (menos de 3 oportunidades recibidas): +1 para que tenga oportunidades reales aunque no tenga historial
  if (of < 3) { pts += 1; m.push('nuevo +1'); }
  // Señal SECUNDARIA: la reputación nunca suma ni resta más de 1 punto (la zona suma 3). A igualdad de puntos manda la
  // rotación (menos oportunidades en 30 días), así que nadie queda «siempre primero».
  var tope = 1, lim = Math.max(-tope, Math.min(tope, pts));
  if (lim !== pts) m.push('tope ±' + tope);
  return { puntos: Math.round(lim * 10) / 10, motivo: m.join(' · ') };
}

/** «Volver a buscar»: nueva ronda sobre la MISMA solicitud (sin rellenar nada otra vez). */
function volverABuscar_(oc) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Estado'] !== 'Sin profesional disponible') return { ok: false, msg: 'Ahora mismo tu solicitud ya está en búsqueda o en curso.' };
    var ronda = rondaDe_(sol) + 1;
    actualizarSol_(sol, { 'Estado': 'Buscando profesional', 'Ronda búsqueda': ronda, 'Requiere intervención': '', 'Decisión cliente': '' });
    registrar_('Sistema', 'El cliente vuelve a buscar (ronda ' + ronda + ')', oc, '', '');
    motor_(oc);
    return { ok: true, msg: 'Hemos vuelto a buscar un profesional para tu solicitud. Te avisaremos por correo cuando haya uno.' };
  });
}
