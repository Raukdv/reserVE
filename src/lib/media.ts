import { publicEnv } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'
import { GALLERY_SIZE } from '@/lib/media-limits'

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

/**
 * URL pública de una foto del sitio.
 *
 * Bucket propio y no un prefijo dentro de `unit-media`: ese nombre dice de qué
 * son sus archivos, y meter ahí fotos que no son de ninguna unidad lo
 * convertiría en mentira.
 */
export const siteMediaUrl = (path: string) =>
  `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-media/${path}`

export type Cover = { url: string; alt: string | null }

/**
 * Fotos de las secciones del sitio, agrupadas por su clave.
 *
 * Una sola consulta para todas las secciones que pida la página: pedirlas de una
 * en una serían tantos viajes como secciones tenga el home.
 */
export async function siteImages(sections: string[]): Promise<Map<string, Cover[]>> {
  const byKey = new Map<string, Cover[]>()
  if (sections.length === 0) return byKey

  const supabase = await createClient()
  const { data } = await supabase
    .from('site_media')
    .select('section_key, storage_path, alt_text')
    .in('section_key', sections)
    .order('section_key')
    .order('sort_order')

  for (const row of data ?? []) {
    const list = byKey.get(row.section_key) ?? []
    list.push({ url: siteMediaUrl(row.storage_path), alt: row.alt_text })
    byKey.set(row.section_key, list)
  }
  return byKey
}

/**
 * Portadas de un conjunto de unidades, listas para pintar.
 *
 * Va contra la vista `unit_covers`, que ya devuelve una fila por unidad: pedir
 * `unit_media` entero y quedarse con la primera de cada grupo traería decenas
 * de filas para pintar una miniatura.
 *
 * Devuelve un mapa y no una lista porque quien llama ya tiene sus unidades
 * ordenadas; lo único que le falta es buscar la de cada una.
 */
export async function unitCovers(unitIds: string[]): Promise<Map<string, Cover>> {
  const covers = new Map<string, Cover>()
  if (unitIds.length === 0) return covers

  const supabase = await createClient()
  const { data } = await supabase
    .from('unit_covers')
    .select('unit_id, storage_path, alt_text')
    .in('unit_id', unitIds)

  for (const row of data ?? []) {
    covers.set(row.unit_id, { url: unitMediaUrl(row.storage_path), alt: row.alt_text })
  }
  return covers
}

/**
 * Fotos de una unidad, para la galería de su ficha.
 *
 * Con tope, como toda lista: la unidad puede tener cuarenta y la ficha muestra
 * las primeras; el resto ni se descargan.
 */
export async function unitPhotos(unitId: string, max = GALLERY_SIZE): Promise<Cover[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('unit_media')
    .select('storage_path, alt_text')
    .eq('unit_id', unitId)
    .order('sort_order')
    .limit(max)

  return (data ?? []).map((row) => ({
    url: unitMediaUrl(row.storage_path),
    alt: row.alt_text,
  }))
}
