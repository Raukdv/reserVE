/**
 * Topes de las fotos de unidades, en un solo sitio.
 *
 * Vivían repartidos entre la acción de servidor, el componente de subida y la
 * definición del bucket, sin nada que obligara a moverlos juntos. Aquí están
 * para que subir el margen —el día que haya plan de pago— sea cambiar un número
 * y no ir a buscarlos.
 *
 * Sin dependencias de servidor a propósito: los importa también el componente
 * de subida, que corre en el navegador.
 *
 * ## Qué cuesta qué
 *
 * Los dos ejes no cuestan lo mismo, y conviene no confundirlos:
 *
 * - **El peso por foto manda sobre el egreso**, que es el techo real del plan
 *   gratuito: 5 GB al mes, y cada visitante que abre el catálogo se descarga
 *   las portadas.
 * - **La cantidad por unidad manda sobre el almacenamiento**, 1 GB, mucho más
 *   holgado. Y solo las cinco primeras salen en la ficha pública: el resto se
 *   ven en el panel y casi no generan tráfico.
 *
 * | Peso por foto | Caben en 1 GB | Cargas en 5 GB/mes |
 * |---|---|---|
 * | 400 KB (hoy)  | ~2.600 | ~13.000 |
 * | 1 MB          | ~1.000 | ~5.000  |
 * | 5 MB          | ~200   | ~1.000  |
 *
 * A 5 MB por foto, cien visitantes que miren diez imágenes cada uno agotan el
 * egreso del mes. Por eso el peso no sube «porque cabe en disco»: cabe, pero no
 * se puede servir. Y no hace falta — comprimidas rondan los 200 KB, así que
 * 400 KB ya deja el doble del margen que se usa.
 *
 * Con plan de pago el egreso deja de ser el límite y estos números pueden
 * subir. Lo que no cambia es que una foto de 5 MB en una web es una foto sin
 * optimizar: el visitante la paga en tiempo de carga aunque el negocio no la
 * pague en factura.
 */

/**
 * Peso máximo de una foto ya comprimida.
 *
 * El bucket admite 600 KB (ver `0013`): el hueco es a propósito, para que un
 * archivo que el servidor acepta no lo rechace el almacenamiento por un
 * redondeo y deje la subida a medias.
 */
export const MAX_PHOTO_BYTES = 400 * 1024

/**
 * Fotos por unidad.
 *
 * Alto a propósito. No está para racionar al operador —el gasto lo marca el
 * peso de cada foto, no cuántas haya— sino para que ninguna lista crezca sin
 * techo: sin tope, una consulta que las pide todas es una bomba de relojería
 * en el presupuesto de CPU del plan Hobby.
 *
 * Cuarenta cubre el caso que de verdad se da: fotografiar el alojamiento por
 * ambientes, como hacen Airbnb y Booking —principal, baños, sala, cocina,
 * entrada— que se va a veinte o treinta sin esfuerzo. A 400 KB cada una son
 * 16 MB por unidad: unas sesenta unidades entran en el gigabyte gratuito, y una
 * posada no tiene sesenta.
 *
 * Cuando la app lleve un tiempo en uso real habrá con qué ajustarlo. Hasta
 * entonces, mejor ancho que estrecho: un tope que estorba se nota enseguida,
 * uno que sobra no molesta a nadie.
 */
export const MAX_PHOTOS_PER_UNIT = 40

/** Fotos de la unidad que se muestran en la ficha pública. */
export const GALLERY_SIZE = 5

/**
 * Compresión antes de subir.
 *
 * 1600 px basta para pantalla completa sin cargar megas por foto.
 */
export const PHOTO_COMPRESSION = { maxEdge: 1600, quality: 0.75 }

export const MAX_PHOTO_KB = MAX_PHOTO_BYTES / 1024
