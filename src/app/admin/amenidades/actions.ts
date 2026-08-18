'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getProfile } from '@/lib/supabase/server'
import { AMENITY_CATEGORIES, ICON_NAMES } from '@/lib/amenities'

export type AmenityState = { error?: string; ok?: string; needsForce?: boolean }

async function requireStaff() {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    throw new Error('No autorizado')
  }
}

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

const schema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  label: z.string().trim().min(2, 'Ponle un nombre').max(60),
  icon: z
    .string()
    .trim()
    .refine((v) => v === '' || ICON_NAMES.includes(v), 'Icono desconocido')
    .or(z.literal('')),
  category: z.enum(
    AMENITY_CATEGORIES.map((c) => c.value) as [string, ...string[]],
  ),
  sortOrder: z.coerce.number().int().min(0).max(99),
})

export async function saveAmenity(
  _prev: AmenityState,
  formData: FormData,
): Promise<AmenityState> {
  await requireStaff()

  const parsed = schema.safeParse({
    id: formData.get('id') ?? '',
    label: formData.get('label'),
    icon: formData.get('icon') ?? '',
    category: formData.get('category'),
    sortOrder: formData.get('sortOrder') || 0,
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const supabase = await createClient()

  const row = {
    label: d.label,
    icon: d.icon || null,
    category: d.category,
    sort_order: d.sortOrder,
  }

  // El slug se deriva del nombre solo al crear: cambiarlo después rompería
  // cualquier referencia externa sin ganar nada.
  const { error } = d.id
    ? await supabase.from('amenities').update(row).eq('id', d.id)
    : await supabase.from('amenities').insert({ ...row, slug: slugify(d.label) })

  if (error) {
    return {
      error:
        error.code === '23505'
          ? 'Ya existe una amenidad con ese nombre.'
          : 'No se pudo guardar.',
    }
  }

  revalidatePath('/admin/amenidades')
  revalidatePath('/admin/unidades', 'layout')
  revalidatePath('/', 'layout')

  return { ok: d.id ? 'Amenidad actualizada.' : 'Amenidad añadida.' }
}

/**
 * Elimina una amenidad del catálogo.
 *
 * Si está en uso pide confirmación: `unit_amenities` cascadea, así que borrarla
 * la quita de todas las unidades sin avisar.
 */
export async function deleteAmenity(
  _prev: AmenityState,
  formData: FormData,
): Promise<AmenityState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Amenidad no válida.' }

  const force = formData.get('force') === 'on'
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('staff_delete_amenity', {
    p_id: id.data,
    p_force: force,
  })

  if (error) return { error: 'No se pudo eliminar.' }

  const result = data as { ok: boolean; error?: string; units?: number }

  if (!result.ok) {
    if (result.error === 'in_use') {
      return {
        needsForce: true,
        error:
          `La usan ${result.units} unidad${result.units === 1 ? '' : 'es'}. ` +
          'Al borrarla desaparece también de ellas.',
      }
    }
    return { error: 'No se pudo eliminar.' }
  }

  revalidatePath('/admin/amenidades')
  revalidatePath('/admin/unidades', 'layout')
  revalidatePath('/', 'layout')

  return { ok: 'Amenidad eliminada.' }
}
