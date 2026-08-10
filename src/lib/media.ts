import { publicEnv } from '@/lib/env'

/**
 * URL pública de una foto de unidad.
 *
 * El bucket `unit-media` es público, así que la dirección se arma sin firmar
 * nada: firmar en cada render sería trabajo de servidor repetido para servir
 * algo que no es secreto. Los comprobantes de pago sí van firmados, porque su
 * bucket es privado.
 */
export const unitMediaUrl = (path: string) =>
  `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/unit-media/${path}`
