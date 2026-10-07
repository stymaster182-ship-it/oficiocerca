/* OficioCerca — iconos de línea propios (24×24) y helper ocIcon(). */
/* Iconos de línea 24×24 (trazo). Diseño propio. */
window.OC_ICONS = {
  bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  drop: '<path d="M12 2.5c3.6 4.3 6 7.7 6 11a6 6 0 0 1-12 0c0-3.3 2.4-6.7 6-11z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
  brick: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 9.7v4.6M9 14.3V19"/>',
  saw: '<path d="M3 15 15 3l3 3L6 18z"/><path d="M6 18l-1.5 1.5M8 13l1.5 1.5M11 10l1.5 1.5"/><path d="M15 3l6 6-3 3"/>',
  chair: '<path d="M7 3h10v8H7z"/><path d="M5 11h14v3H5z"/><path d="M7 14v7M17 14v7"/>',
  slab: '<path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v4l9 4 9-4V8"/><path d="M8 7.5l3 1.3M13 6l2.5 1"/>',
  roller: '<rect x="3" y="3" width="15" height="6" rx="1.5"/><path d="M18 6h2.5v5H11v3"/><rect x="9.5" y="14" width="3" height="7" rx="1"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8 20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  panel: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M4 9h16M4 15h16"/>',
  snow: '<path d="M12 2v20M4 7l16 10M20 7 4 17"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/>',
  tiles: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  roof: '<path d="M2 13 12 5l10 8"/><path d="M5 11v9h14v-9"/><path d="M6 13.5h12M7 16.5h10"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  wrench: '<path d="M14.5 3.5a5 5 0 0 0-5.6 6.7L3 16.1V21h4.9l5.9-5.9a5 5 0 0 0 6.7-5.6l-3.2 3.2-3.3-.8-.8-3.3z"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  camera: '<path d="M4 7.5h3.5L9 5h6l1.5 2.5H20V19H4z"/><circle cx="12" cy="13" r="3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>'
};
window.ocIcon = function (name, cls) {
  var p = (window.OC_ICONS[name] || window.OC_ICONS.plus);
  return '<svg class="' + (cls || 'ico') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
};
