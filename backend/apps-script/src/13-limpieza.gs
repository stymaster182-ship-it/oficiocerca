/* ============================================================ LIMPIEZA DE DATOS DE PRUEBA (cierre pre-piloto)
 * Se ejecuta A MANO desde el editor: limpiarPruebaOC0001().
 * - Borra SOLO las filas ligadas a los códigos indicados (pruebas confirmadas por el propietario) en todas las pestañas
 *   operativas, y envía a la papelera de Drive su carpeta de fotos (si existe). No toca profesionales ni configuración.
 * - Reinicia SOLO el contador de solicitudes (SEQ_OC) y SOLO si después no queda ninguna solicitud ni ninguna fila que
 *   mencione un código OC: así el siguiente código (OC-0001) no puede colisionar con nada. Los demás contadores no cambian.
 * - Idempotente: si ya no hay nada que borrar, no hace nada (y vuelve a comprobar el contador).
 */
var PESTANAS_CON_OC = ['Solicitudes', 'Ofertas', 'Presupuestos', 'Comisiones', 'Pagos comisión', 'Eventos Wompi', 'Incidencias', 'Valoraciones',
  'Historial envíos', 'Registro', 'Tokens'];

function limpiarSolicitudesDePrueba_(codigos, clavesExtra) {
  var informe = [], fotos = [];
  conLock_(function () {
    PESTANAS_CON_OC.forEach(function (n) {
      var t = tabla_(n), colOC = n === 'Solicitudes' ? 'Código' : (t.cols.indexOf('Código OC') >= 0 ? 'Código OC' : null);
      if (!colOC && n !== 'Historial envíos') return;
      var filas = t.todas().filter(function (r) {
        return (colOC && codigos.indexOf(String(r[colOC]).trim()) >= 0) || (n === 'Historial envíos' && (clavesExtra || []).indexOf(String(r['Clave'])) >= 0);
      });
      if (n === 'Solicitudes') filas.forEach(function (r) { if (r['Carpeta fotos (ID)']) fotos.push(r['Carpeta fotos (ID)']); });
      filas.map(function (r) { return r._fila; }).sort(function (a, b) { return b - a; }).forEach(function (f) { t.sh.deleteRow(f); });
      t._cache = null;
      informe.push(n + ': ' + filas.length + ' fila(s) borradas');
    });
    fotos.forEach(function (id) { try { DriveApp.getFolderById(id).setTrashed(true); informe.push('Carpeta de fotos a la papelera: ' + id); } catch (e) { informe.push('Carpeta de fotos no encontrada: ' + id); } });
    _tablas = {};
    // Reinicio seguro del contador de solicitudes
    var quedan = tabla_('Solicitudes').todas().length, conOC = 0;
    PESTANAS_CON_OC.forEach(function (n) {
      var t = tabla_(n), c = n === 'Solicitudes' ? 'Código' : (t.cols.indexOf('Código OC') >= 0 ? 'Código OC' : null);
      if (c) conOC += t.todas().filter(function (r) { return /^OC-\d+/.test(String(r[c]).trim()); }).length;
    });
    var props = PropertiesService.getScriptProperties(), antes = props.getProperty('SEQ_OC');
    if (quedan === 0 && conOC === 0) {
      props.setProperty('SEQ_OC', '0');
      informe.push('SEQ_OC: ' + antes + ' → 0 (la próxima solicitud real será OC-0001)');
    } else informe.push('SEQ_OC NO reiniciado (' + antes + '): quedan ' + quedan + ' solicitud(es) y ' + conOC + ' fila(s) con código OC');
    informe.push('Otros contadores sin cambios: SEQ_PRO=' + props.getProperty('SEQ_PRO') + ' · SEQ_INC=' + props.getProperty('SEQ_INC'));
  });
  registrar_('Admin', 'Limpieza de datos de prueba', '', '', codigos.length + ' solicitud(es) de prueba del propietario eliminada(s)');
  try { actualizarPanel(); } catch (e) { }
  informe.forEach(function (l) { Logger.log(l); });
  return informe;
}

/** OC-0001 fue una prueba del propietario (autorizada su eliminación). También su resumen diario de ese día. */
function limpiarPruebaOC0001() { return limpiarSolicitudesDePrueba_(['OC-0001'], ['admin-resumen-09/10/2026']); }
