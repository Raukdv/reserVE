/**
 * Secciones del sitio que admiten foto, y dónde sale cada una.
 *
 * Vive aquí y no junto a las acciones de Contenido porque aquel archivo lleva
 * `'use server'`, y un módulo así **solo puede exportar funciones async**. Una
 * constante exportada desde ahí no llega al cliente como su valor: llega como
 * una referencia de acción de servidor, y cualquier `.find` o `.map` sobre ella
 * revienta en tiempo de ejecución.
 *
 * El compilador de tipos no lo detecta —los tipos son correctos— así que el
 * fallo solo aparece al abrir la página.
 *
 * `sin_asignar` no es una sección de verdad: es donde caen las recién subidas.
 * La web pública nunca la consulta, así que una foto ahí existe en el panel sin
 * verse en ningún lado. Subir un lote y repartirlo después es como se trabaja.
 */
export const SITE_IMAGE_SECTIONS = [
  { key: 'sin_asignar', label: 'Sin asignar', where: 'No se ve en la web todavía' },
  { key: 'hero', label: 'Portada', where: 'Fondo de la cabecera del inicio' },
  { key: 'about', label: 'Sobre el negocio', where: 'Junto al texto de «sobre nosotros»' },
  { key: 'location', label: 'Cómo llegar', where: 'Junto a las indicaciones de ubicación' },
] as const

export const SITE_SECTION_KEYS = SITE_IMAGE_SECTIONS.map((s) => s.key)

export type SiteSectionKey = (typeof SITE_IMAGE_SECTIONS)[number]['key']
