'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getProfile } from '@/lib/supabase/server'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export type RateState = { error?: string; ok?: string }

async function requireStaff() {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    throw new Error('No autorizado')
  }
}

const seasonSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  unitId: z.string().uuid('Elige una unidad'),
  name: z.string().trim().min(2, 'Ponle un nombre a la temporada').max(80),
  from: z.string().regex(ISO, 'Revisa la fecha de inicio'),
  to: z.string().regex(ISO, 'Revisa la fecha de fin'),
  price: z.coerce.number().min(0, 'El precio no puede ser negativo'),
  minNights: z.coerce.number().int().min(0).max(365),
})

/**
 * Crea o actualiza una temporada.
 *
 * El rango es semiabierto, igual que las estadías: una temporada del 15 de
 * diciembre al 8 de enero cubre las noches del 15 al 7, y el 8 ya es tarifa
 * normal.
 *
 * Dos temporadas no pueden solaparse sobre la misma unidad —lo impide una
 * restricción EXCLUDE en la base— porque el precio de esa noche sería ambiguo.
 */
export async function saveSeason(_prev: RateState, formData: FormData): Promise<RateState> {
  await requireStaff()

  const parsed = seasonSchema.safeParse({
    id: formData.get('id') ?? '',
    unitId: formData.get('unitId'),
    name: formData.get('name'),
    from: formData.get('from'),
    to: formData.get('to'),
    price: formData.get('price'),
    minNights: formData.get('minNights') || 0,
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  if (d.to <= d.from) return { error: 'La fecha de fin debe ser posterior a la de inicio.' }

  const supabase = await createClient()

  const row = {
    unit_id: d.unitId,
    name: d.name,
    period: `[${d.from},${d.to})`,
    price_usd: d.price,
    // 0 significa «usa el mínimo de la unidad».
    min_nights: d.minNights > 0 ? d.minNights : null,
  }

  const { error } = d.id
    ? await supabase.from('season_rates').update(row).eq('id', d.id)
    : await supabase.from('season_rates').insert(row)

  if (error) {
    // 23P01 es la violación del EXCLUDE que impide solapar temporadas.
    return {
      error: error.code === '23P01'
        ? 'Se solapa con otra temporada de esa unidad. El precio de esas noches sería ambiguo.'
        : 'No se pudo guardar la temporada.',
    }
  }

  revalidatePath('/admin/tarifas')
  revalidatePath('/alojamientos', 'layout')

  return { ok: d.id ? 'Temporada actualizada.' : 'Temporada creada.' }
}

export async function deleteSeason(
  _prev: RateState,
  formData: FormData,
): Promise<RateState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Temporada no válida.' }

  const supabase = await createClient()
  const { error } = await supabase.from('season_rates').delete().eq('id', id.data)

  if (error) return { error: 'No se pudo eliminar.' }

  revalidatePath('/admin/tarifas')
  revalidatePath('/alojamientos', 'layout')

  return { ok: 'Temporada eliminada.' }
}

/**
 * Copia las temporadas de una unidad a otras.
 *
 * Una posada suele tener las mismas fechas altas para todas sus unidades y solo
 * cambia el precio. Cargarlas a mano en cada una es donde se cometen errores.
 */
export async function copySeasons(_prev: RateState, formData: FormData): Promise<RateState> {
  await requireStaff()

  const sourceId = z.string().uuid().safeParse(formData.get('sourceId'))
  if (!sourceId.success) return { error: 'Unidad de origen no válida.' }

  const targets = formData.getAll('target').map(String)
  if (targets.length === 0) return { error: 'Elige al menos una unidad de destino.' }

  const supabase = await createClient()

  const { data: seasons } = await supabase
    .from('season_rates')
    .select('name, period, price_usd, min_nights')
    .eq('unit_id', sourceId.data)

  if (!seasons || seasons.length === 0) {
    return { error: 'La unidad de origen no tiene temporadas.' }
  }

  let copied = 0
  const skipped: string[] = []

  for (const target of targets) {
    // Se copian una a una para poder saltar las que solapen en el destino en
    // lugar de abortar el lote entero.
    for (const season of seasons) {
      const { error } = await supabase.from('season_rates').insert({
        unit_id: target,
        name: season.name,
        period: season.period,
        price_usd: season.price_usd,
        min_nights: season.min_nights,
      })
      if (error) skipped.push(season.name)
      else copied++
    }
  }

  revalidatePath('/admin/tarifas')
  revalidatePath('/alojamientos', 'layout')

  return {
    ok:
      `${copied} temporada${copied === 1 ? '' : 's'} copiada${copied === 1 ? '' : 's'}` +
      (skipped.length > 0
        ? `. ${skipped.length} se saltaron por solaparse con temporadas ya existentes.`
        : '.'),
  }
}
