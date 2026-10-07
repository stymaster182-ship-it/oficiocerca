/* ============================================================ PÁGINAS DE LOS ENLACES (doGet ?t=TOKEN) */

function doGet(e) {
  var t = e && e.parameter && e.parameter.t;
  if (!t) return json_({ ok: true, service: 'OficioCerca', status: 'online' });
  try { return pagina_(String(t)); }
  catch (err) { errorSistema_('doGet', err); return html_('Algo ha fallado', '<p>No hemos podido abrir esta página. Inténtalo de nuevo en unos minutos o escríbenos a <a href="mailto:oficiocerca@gmail.com">oficiocerca@gmail.com</a>.</p>'); }
}

var _modoJson = false;

/** Versión JSON de una página (la usa la página estática /gestion/ de la web). */
function paginaJson_(t) {
  _modoJson = true;
  try { var r = pagina_(String(t || '')); return { ok: true, titulo: r.titulo, cuerpo: r.cuerpo, script: r.script || '' }; }
  catch (err) { errorSistema_('paginaJson', err); return { ok: false, titulo: 'Algo ha fallado', cuerpo: '<p>No hemos podido abrir esta página. Inténtalo de nuevo en unos minutos.</p>' }; }
  finally { _modoJson = false; }
}

function html_(titulo, cuerpo, token, script) {
  if (_modoJson) return { titulo: titulo, cuerpo: cuerpo, script: script || '' };
  var css = 'body{margin:0;background:#F6F2EB;font-family:Arial,Helvetica,sans-serif;color:#0E1A2B;font-size:18px;line-height:1.5}' +
    '.top{background:#13253D;color:#fff;padding:16px 20px;font-weight:bold;font-size:21px;letter-spacing:.5px}.top b{color:#F2A65A}' +
    '.box{max-width:640px;margin:18px auto;background:#fff;border-radius:14px;padding:22px 20px;box-shadow:0 2px 10px rgba(0,0,0,.06)}' +
    'h1{font-size:24px;margin:0 0 14px;line-height:1.25}h2{font-size:20px;margin:22px 0 10px}' +
    'table{border-collapse:collapse;width:100%;margin:10px 0}td{border:1px solid #DED6C8;padding:9px;vertical-align:top}td:first-child{background:#F6F2EB;font-weight:bold;width:40%}' +
    '.btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:12px;padding:17px 16px;margin:12px 0;font-size:19px;font-weight:bold;cursor:pointer;background:#13253D;color:#fff;text-align:center}' +
    '.btn.sec{background:#fff;color:#13253D;border:2px solid #13253D}.btn.rojo{background:#fff;color:#A3262A;border:2px solid #A3262A}.btn:disabled{opacity:.55;cursor:wait}' +
    'label{display:block;font-weight:bold;margin:14px 0 6px}select,input,textarea{width:100%;box-sizing:border-box;font-size:18px;padding:13px;border:2px solid #8B95A3;border-radius:10px;background:#fff;color:#0E1A2B}' +
    'textarea{min-height:110px}.opc{border:2px solid #DED6C8;border-radius:12px;padding:6px 16px 10px;margin:14px 0}.nota{color:#586374;font-size:15px}' +
    '.ok{background:#E8F5EC;border-left:5px solid #2E7D4F;padding:14px;border-radius:8px}.err{background:#FDECEC;border-left:5px solid #A3262A;padding:14px;border-radius:8px}' +
    '.stars{display:flex;gap:6px;flex-wrap:wrap}.stars label{margin:0;flex:1;min-width:52px}.stars input{display:none}.stars span{display:block;text-align:center;border:2px solid #8B95A3;border-radius:10px;padding:12px 0;font-size:22px;cursor:pointer}' +
    '.stars input:checked+span{background:#13253D;color:#F2A65A;border-color:#13253D}.hide{display:none}';
  var js = '<script>var T=' + JSON.stringify(token || '') + ';' +
    'function enviar(p,btn){var bs=document.querySelectorAll("button");bs.forEach(function(b){b.disabled=true});' +
    'var m=document.getElementById("msg");m.className="";m.textContent="Enviando…";' +
    'google.script.run.withSuccessHandler(function(r){if(r&&r.ok){document.getElementById("zona").innerHTML="";m.className="ok";m.textContent=r.msg;' +
    'if(r.html){document.getElementById("zona").innerHTML=r.html}}else{m.className="err";m.textContent=(r&&r.msg)||"No se pudo guardar.";bs.forEach(function(b){b.disabled=false})}})' +
    '.withFailureHandler(function(){m.className="err";m.textContent="No hemos podido guardar tu respuesta. Revisa tu conexión e inténtalo de nuevo.";bs.forEach(function(b){b.disabled=false})})' +
    '.accion(T,p)}' +
    'function ver(id){document.querySelectorAll(".panel").forEach(function(x){x.classList.add("hide")});var e=document.getElementById(id);if(e){e.classList.remove("hide");e.scrollIntoView({behavior:"smooth"})}}' +
    'function val(id){var e=document.getElementById(id);return e?e.value:""}' + (script || '') + '</script>';
  var out = HtmlService.createHtmlOutput('<!doctype html><html lang="es"><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    '<div class="top">OFICIO<b>CERCA</b></div><div class="box"><h1>' + esc_(titulo) + '</h1><div id="zona">' + cuerpo + '</div><p id="msg" role="status" aria-live="polite"></p>' +
    '<p class="nota">¿Dudas? Escríbenos a <a href="mailto:oficiocerca@gmail.com">oficiocerca@gmail.com</a></p></div>' + js + '</body></html>');
  out.setTitle('OficioCerca').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return out;
}

function filas_(f) { return '<table>' + f.map(function (x) { return '<tr><td>' + esc_(x[0]) + '</td><td>' + esc_(x[1]).replace(/\n/g, '<br>') + '</td></tr>'; }).join('') + '</table>'; }

function pagina_(t) {
  var tok = leerToken_(t);
  if (!tok) return html_('Enlace no válido', '<p>Este enlace no es válido o está incompleto. Abre el botón directamente desde el correo que te enviamos.</p>');
  var tipo = tok['Tipo'], oc = tok['Código OC'], pro = tok['Código PRO'];
  var sol = oc ? solicitud_(oc) : null;
  var unUso = ['oferta', 'respaldo', 'presupuesto', 'fin'].indexOf(tipo) >= 0;
  if (unUso && tok['Usado']) return html_('Respuesta ya registrada', '<div class="ok">Ya habíamos registrado tu respuesta: ' + esc_(tok['Resultado'] || '') + '</div>');
  if (tok.caducado) return html_('Enlace caducado', '<p>Este enlace ya no está vigente' + (tipo === 'oferta' ? ': el plazo para responder a esta oportunidad terminó y la ofrecimos a otro profesional.' : '.') + '</p><p>Si necesitas algo, escríbenos.</p>');

  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  if (tipo === 'oferta') {
    var of = tabla_('Ofertas').buscar('ID', tok['Referencia']);
    if (!of || of['Estado'] !== 'Enviada') return html_('Oportunidad cerrada', '<p>Esta oportunidad ya no está abierta. ¡Gracias!</p>');
    var opts = Object.keys(DISP_PRO).filter(function (k) { return k !== 'OTRA_FECHA'; }).map(function (k) { return '<option value="' + k + '">' + esc_(DISP_PRO[k].t) + '</option>'; }).join('');
    return html_('Oportunidad ' + oc, filas_([['Servicio', servicioTxt_(sol)], ['Zona / barrio', sol['Zona'] + ' (Córdoba)'], ['Tipo de trabajo', sol['Tipo de trabajo'] || 'Sin especificar'],
      ['Plazo que pide el cliente', plazoTxt_(sol)], ['Descripción', sol['Descripción']], ['Responde antes de', fecha_(of['Expira'])]]) +
      '<p class="nota">Aceptar significa: «Estoy interesado y tengo disponibilidad para contactar al cliente y valorar/presupuestar el trabajo». No te compromete todavía a ejecutar la obra.</p>' +
      '<button class="btn" onclick="ver(\'pa\')">✔ PUEDO ATENDERLO</button>' +
      '<div id="pa" class="panel opc hide"><label for="disp">¿Cuándo podrías empezar?</label><select id="disp">' + opts + '</select>' +
      '<button class="btn" onclick="enviar({a:\'si\',disp:val(\'disp\')})">Confirmar: puedo atenderlo</button></div>' +
      '<button class="btn sec" onclick="ver(\'pb\')">🕒 PUEDO HACERLO, PERO MÁS ADELANTE</button>' +
      '<div id="pb" class="panel opc hide"><label for="fecha">¿A partir de qué fecha aproximada?</label><input type="date" id="fecha" min="' + hoy + '">' +
      '<button class="btn sec" onclick="if(!val(\'fecha\')){alert(\'Elige una fecha\');return}enviar({a:\'mas_adelante\',fecha:val(\'fecha\')})">Confirmar fecha</button></div>' +
      '<button class="btn rojo" onclick="ver(\'pc\')">✖ NO PUEDO / NO ME INTERESA</button>' +
      '<div id="pc" class="panel opc hide"><label for="nota">Motivo (opcional)</label><input id="nota" maxlength="200">' +
      '<button class="btn rojo" onclick="enviar({a:\'no\',nota:val(\'nota\')})">Confirmar: no puedo</button></div>', t);
  }
  if (tipo === 'respaldo') {
    var ofr = tabla_('Ofertas').buscar('ID', tok['Referencia']);
    if (sol['Estado'] !== 'Esperando decisión cliente') return html_('Solicitud ' + oc, '<p>Estado actual de tu solicitud: <b>' + esc_(sol['Estado']) + '</b>.</p>');
    return html_('Disponibilidad para tu solicitud ' + oc, '<p>Pediste: <b>' + esc_(plazoTxt_(sol)) + '</b>. La opción más próxima que encontramos puede atenderte aproximadamente: <b>' + esc_(ofr ? ofr['Disponibilidad'] : '') + '</b>.</p>' +
      '<button class="btn" onclick="enviar({a:\'continuar\'})">Sí, continuar con este profesional</button>' +
      '<button class="btn sec" onclick="enviar({a:\'seguir\'})">Seguir buscando</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar la solicitud?\'))enviar({a:\'cancelar\'})">Cancelar solicitud</button>' +
      '<p class="nota">Hasta que elijas, no compartimos tus datos de contacto con ningún profesional.</p>', t);
  }
  if (tipo === 'presupuesto') {
    var pr = tabla_('Presupuestos').buscar('ID', tok['Referencia']), pp = profesional_(pro);
    if (!pr) return html_('Presupuesto', '<p>Presupuesto no encontrado.</p>');
    if (pr['Estado'] !== 'Enviado al cliente' || sol['Presupuesto vigente'] !== pr['ID']) return html_('Presupuesto ' + pr['ID'], '<p>Este presupuesto está: <b>' + esc_(pr['Estado']) + '</b>.' + (pr['Estado'] === 'Sustituido' ? ' Revisa el correo con la versión más reciente.' : '') + '</p>');
    return html_('Presupuesto para tu solicitud ' + oc, filas_([['Profesional', pp ? pp['Nombre'] + (pp['Empresa / autónomo'] ? ' · ' + pp['Empresa / autónomo'] : '') : pro],
      ['Mano de obra', euros_(pr['Mano de obra (€)'])], ['Materiales', euros_(pr['Materiales (€)'])], ['Total', euros_(pr['Total (€)'])], ['Observaciones', pr['Observaciones'] || '—'], ['Versión', pr['Versión']]]) +
      '<button class="btn" onclick="if(confirm(\'¿Aceptas este presupuesto?\'))enviar({a:\'aceptar\'})">✔ Aceptar presupuesto</button>' +
      '<button class="btn sec" onclick="enviar({a:\'hablar\'})">Necesito hablar con el profesional</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿No aceptas este presupuesto?\'))enviar({a:\'rechazar\'})">No aceptar</button>' +
      '<p class="nota">Aceptar es libre y gratuito para ti. El pago del trabajo se hace directamente al profesional.</p>', t);
  }
  if (tipo === 'fin') {
    if (sol['Estado'] !== 'Finalización por confirmar') return html_('Solicitud ' + oc, '<p>Estado actual: <b>' + esc_(sol['Estado']) + '</b>.</p>');
    return html_('¿Ha terminado el trabajo? · ' + oc, '<p>El profesional ha indicado que el trabajo finalizó.</p>' +
      '<button class="btn" onclick="enviar({a:\'si\'})">✔ Sí, el trabajo terminó</button>' +
      '<button class="btn sec" onclick="enviar({a:\'aun_no\'})">Aún no ha terminado</button>' +
      '<button class="btn rojo" onclick="ver(\'pp\')">Tengo un problema</button>' +
      '<div id="pp" class="panel opc hide"><label for="txt">Cuéntanos qué ha pasado</label><textarea id="txt" maxlength="1500"></textarea>' +
      '<label><input type="checkbox" id="grave" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de mis datos)</label>' +
      '<button class="btn rojo" onclick="if(!val(\'txt\').trim()){alert(\'Describe el problema\');return}enviar({a:\'problema\',texto:val(\'txt\'),grave:document.getElementById(\'grave\').checked})">Enviar problema</button></div>', t);
  }
  if (tipo === 'valorar') {
    var ya = tabla_('Valoraciones').todas().some(function (v) { return v['Código OC'] === oc; });
    var estrellas = [1, 2, 3, 4, 5].map(function (n) { return '<label><input type="radio" name="st" value="' + n + '"><span>' + n + '★</span></label>'; }).join('');
    var cats = CATEGORIAS_INCIDENCIA.filter(function (c) { return c !== 'Valoración baja'; }).map(function (c) { return '<option>' + esc_(c) + '</option>'; }).join('');
    return html_('Valora el servicio · ' + oc, (ya ? '<div class="ok">Ya recibimos tu valoración. ¡Gracias!</div>' :
      '<label>¿Cómo valoras el servicio? (1 = muy mal · 5 = excelente)</label><div class="stars">' + estrellas + '</div>' +
      '<label for="com">Comentario (opcional)</label><textarea id="com" maxlength="1000"></textarea>' +
      '<button class="btn" onclick="var s=document.querySelector(\'input[name=st]:checked\');if(!s){alert(\'Elige de 1 a 5 estrellas\');return}enviar({a:\'valorar\',estrellas:s.value,comentario:val(\'com\')})">Enviar valoración</button>') +
      '<h2>¿Algo más?</h2>' +
      '<button class="btn rojo" onclick="ver(\'pq\')">Tuve un problema</button>' +
      '<button class="btn sec" onclick="ver(\'ps\')">Quiero ayudaros a mejorar</button>' +
      '<div id="pq" class="panel opc hide"><label for="cat">Tipo de problema</label><select id="cat">' + cats + '</select><label for="tq">Cuéntanos</label><textarea id="tq" maxlength="1500"></textarea>' +
      '<label><input type="checkbox" id="gq" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de datos)</label>' +
      '<button class="btn rojo" onclick="if(!val(\'tq\').trim()){alert(\'Escribe qué ha pasado\');return}enviar({a:\'problema\',categoria:val(\'cat\'),texto:val(\'tq\'),grave:document.getElementById(\'gq\').checked})">Enviar</button></div>' +
      '<div id="ps" class="panel opc hide"><label for="ts">Tu sugerencia</label><textarea id="ts" maxlength="1500"></textarea>' +
      '<button class="btn sec" onclick="if(!val(\'ts\').trim()){alert(\'Escribe tu sugerencia\');return}enviar({a:\'sugerencia\',texto:val(\'ts\')})">Enviar sugerencia</button></div>', t);
  }
  if (tipo === 'gestion') {
    var p = profesional_(pro);
    if (sol['Profesional asignado (PRO)'] !== pro) return html_('Solicitud ' + oc, '<p>Esta solicitud ya no está asignada a ti.</p>');
    var pres = tabla_('Presupuestos').todas().filter(function (r) { return r['Código OC'] === oc; });
    var lista = pres.length ? '<h2>Tus presupuestos</h2>' + filas_(pres.map(function (r) { return ['Versión ' + r['Versión'] + ' · ' + dia_(r['Fecha']), euros_(r['Total (€)']) + ' (MO ' + euros_(r['Mano de obra (€)']) + ' + materiales ' + euros_(r['Materiales (€)']) + ') · ' + r['Estado']]; })) : '';
    var cuerpo = filas_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Cliente', sol['Nombre']], ['Estado', sol['Estado']]]) + lista;
    if (ESTADOS_PERMITEN_PRESUPUESTO.indexOf(sol['Estado']) >= 0) {
      cuerpo += '<h2>' + (pres.length ? 'Registrar nueva versión del presupuesto' : 'Registrar presupuesto') + '</h2>' +
        '<label for="mo">Mano de obra (€) *</label><input id="mo" inputmode="decimal" placeholder="Ej.: 350" oninput="tot()">' +
        '<label for="mat">Materiales (€) <span class="nota">(si los hay)</span></label><input id="mat" inputmode="decimal" placeholder="0" oninput="tot()">' +
        '<p>Total: <b id="tt">0,00 €</b> <span class="nota">(mano de obra + materiales)</span></p>' +
        '<label for="obs">Observaciones (opcional)</label><textarea id="obs" maxlength="1000" placeholder="Qué incluye, plazo de ejecución…"></textarea>' +
        '<button class="btn" onclick="if(!val(\'mo\').trim()){alert(\'Indica la mano de obra\');return}if(confirm(\'¿Enviar este presupuesto al cliente?\'))enviar({a:\'presupuesto\',mo:val(\'mo\'),mat:val(\'mat\'),obs:val(\'obs\')})">Enviar presupuesto al cliente</button>' +
        '<p class="nota">Declara importes reales. La tarifa de OficioCerca (10 % de la mano de obra aceptada, máx. 200 €) solo se calcula si el cliente acepta; en el piloto no se cobra todavía. Falsear importes puede conllevar revisión o suspensión.</p>';
    }
    if (sol['Estado'] === 'Cliente aceptó') cuerpo += '<h2>¿Has terminado el trabajo?</h2><button class="btn" onclick="if(confirm(\'¿Confirmas que el trabajo está terminado?\'))enviar({a:\'finalizado\'})">✔ TRABAJO FINALIZADO</button><p class="nota">El cliente deberá confirmarlo.</p>';
    if (sol['Estado'] === 'Finalización por confirmar') cuerpo += '<div class="ok">Esperando que el cliente confirme la finalización.</div>';
    return html_('Gestionar trabajo · ' + oc, cuerpo, t, 'function n(v){v=(v||"").replace(/\\s|€/g,"");if(/,\\d{1,2}$/.test(v))v=v.replace(/\\./g,"").replace(",",".");else v=v.replace(/,/g,"");var x=parseFloat(v);return isNaN(x)?0:x}' +
      'function tot(){var t=n(val("mo"))+n(val("mat"));document.getElementById("tt").textContent=t.toFixed(2).replace(".",",")+" €"}');
  }
  if (tipo === 'cliente') {
    var cancelable = ['Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente', 'Sin profesional compatible'].indexOf(sol['Estado']) >= 0;
    return html_('Tu solicitud ' + oc, filas_([['Servicio', servicioTxt_(sol)], ['Zona', sol['Zona']], ['Estado', sol['Estado']]]) +
      '<button class="btn sec" onclick="ver(\'ph\')">Necesito ayuda</button>' +
      '<div id="ph" class="panel opc hide"><label for="th">¿En qué te ayudamos?</label><textarea id="th" maxlength="1500"></textarea>' +
      '<label><input type="checkbox" id="gh" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de mis datos)</label>' +
      '<button class="btn sec" onclick="if(!val(\'th\').trim()){alert(\'Escribe tu consulta\');return}enviar({a:\'ayuda\',texto:val(\'th\'),grave:document.getElementById(\'gh\').checked})">Enviar</button></div>' +
      (cancelable ? '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar tu solicitud?\'))enviar({a:\'cancelar\'})">Cancelar mi solicitud</button>' : ''), t);
  }
  return html_('Enlace no válido', '<p>Tipo de enlace desconocido.</p>');
}

/** Única función llamada desde las páginas (google.script.run). Revalida el token en cada llamada. */
function accion(t, p) {
  try {
    p = p || {};
    var tok = leerToken_(t);
    if (!tok) return { ok: false, msg: 'Enlace no válido.' };
    if (tok.caducado) return { ok: false, msg: 'Este enlace ha caducado.' };
    var tipo = tok['Tipo'], oc = tok['Código OC'], pro = tok['Código PRO'], r;
    var unUso = ['oferta', 'respaldo', 'presupuesto', 'fin'].indexOf(tipo) >= 0;
    if (unUso && tok['Usado']) return { ok: true, ya: true, msg: 'Ya habíamos registrado tu respuesta: ' + tok['Resultado'] };
    switch (tipo) {
      case 'oferta': r = procesarRespuestaOferta_(tok['Referencia'], p.a, p.disp, p.fecha, p.nota); break;
      case 'respaldo': r = procesarDecisionRespaldo_(tok['Referencia'], p.a); break;
      case 'presupuesto': r = procesarRespuestaPresupuesto_(tok['Referencia'], p.a); break;
      case 'fin': r = procesarFinCliente_(oc, p.a, p.texto, p.grave === true); break;
      case 'valorar':
        if (p.a === 'valorar') r = procesarValoracion_(oc, p.estrellas, p.comentario);
        else if (p.a === 'problema') r = procesarComentarioCliente_(oc, 'problema', p.categoria, p.texto, p.grave === true);
        else if (p.a === 'sugerencia') r = procesarComentarioCliente_(oc, 'sugerencia', 'Sugerencia para OficioCerca', p.texto, false);
        break;
      case 'gestion':
        if (p.a === 'presupuesto') r = registrarPresupuesto_(oc, pro, p.mo, p.mat, p.obs);
        else if (p.a === 'finalizado') r = marcarFinalizado_(oc, pro);
        break;
      case 'cliente':
        if (p.a === 'ayuda') r = procesarComentarioCliente_(oc, 'ayuda', 'Otro', p.texto, p.grave === true);
        else if (p.a === 'cancelar') r = conLock_(function () {
          var sol = solicitud_(oc);
          if (sol['Estado'] === 'Cancelada') return { ok: true, ya: true, msg: 'Tu solicitud ya estaba cancelada.' };
          if (['Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente', 'Sin profesional compatible'].indexOf(sol['Estado']) < 0)
            return { ok: false, msg: 'Tu solicitud ya tiene profesional asignado. Si quieres cancelarla, usa «Necesito ayuda».' };
          cancelarSolicitud_(sol, 'Cancelada por el cliente');
          return { ok: true, msg: 'Hemos cancelado tu solicitud.' };
        });
        break;
    }
    if (!r) return { ok: false, msg: 'Acción no válida.' };
    if (r.ok && unUso && !r.noConsume) marcarToken_(tok, r.msg);
    if (r.ok && r.valorar) r.msg += ' También puedes valorarlo desde el correo que acabamos de enviarte.';
    try { actualizarPanel(); } catch (e) { }
    return { ok: !!r.ok, msg: r.msg };
  } catch (err) {
    errorSistema_('accion', err);
    return { ok: false, msg: 'Ha ocurrido un error. Inténtalo de nuevo en unos minutos.' };
  }
}
