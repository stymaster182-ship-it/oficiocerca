/*
 * OficioCerca — configuración pública del sitio.
 * Aquí NO van claves privadas: todo lo de este archivo es visible en GitHub.
 *
 * ENDPOINT: URL pública del Web App de Google Apps Script (termina en /exec).
 *   Mientras esté vacío, los formularios muestran un aviso honesto y NO simulan envíos.
 * WHATSAPP_SUPPORT: número oficial de WhatsApp Business de OficioCerca (soporte humano), en formato
 *   internacional sin "+" ni espacios. ÚNICO lugar donde está: para cambiarlo, edita solo esta línea.
 *   No se escribe en ninguna página; solo va dentro de los enlaces de los botones «Hablar con un asesor».
 *   Vacío = no se muestra ningún botón de asesor.
 * OC_VIDEOS: vídeos definitivos (todavía no entregados). Cada clave corresponde a un hueco ya colocado en la web
 *   (data-video-slot). Vacío = el hueco no se muestra. Para integrar un vídeo basta poner aquí la ruta del archivo
 *   (p. ej. "/assets/video/despues-solicitud.mp4") o una URL de YouTube, sin reconstruir ninguna página.
 *   despues_solicitud → confirmación de /solicitar/ («¿Qué pasa después de enviar tu solicitud?»)
 *   despues_registro → confirmación de /profesionales/
 *   clientes_cordoba → landing /clientes/cordoba/ («Cómo funciona OficioCerca para clientes»)
 *   profesionales_cordoba → landing /profesionales/cordoba/ («OficioCerca para profesionales», 15–30 s; institucional profesional)
 *   general → flujo completo (Inicio «Cómo funciona» y Ayuda) · cliente → tutorial cliente · profesional → tutorial profesional
 *   Las piezas institucionales para redes (cliente, profesional, general) no necesitan hueco: el institucional general
 *   sustituye a assets/video/oficiocerca-institucional.mp4 (vídeo actual de Inicio).
 */
window.OC_CONFIG = {
  ENDPOINT: "https://script.google.com/macros/s/AKfycbyjOjHiDWHdLwXx23eMkHZi7z2PYbTRiuqYYQvfe7HGRdnPfWqNO9MlhB-pl0_BrCHZ/exec",
  WHATSAPP_SUPPORT: "573000179524",
  CONTACT_EMAIL: "oficiocerca@gmail.com",
  SITE_URL: "https://oficiocerca.pages.dev/",
  MAX_PHOTOS: 5,
  PHOTO_MAX_SIDE: 1600,
  PHOTO_QUALITY: 0.78
};
window.OC_VIDEOS = {
  despues_solicitud: "",
  despues_registro: "",
  general: "",
  cliente: "",
  profesional: "",
  profesionales_cordoba: "",
  clientes_cordoba: ""
};
