'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, createAdminClient, getProfile } from '@/lib/supabase/server'
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_UNIT } from '@/lib/media-limits'

const MEDIA_BUCKET = 'unit-media'

const ALLOWED_TYPES = ['image/webp', 'image/jpeg', 'image/png']
const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export type UnitState = { error?: string; ok?: string }

async function requireStaff() {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    throw new Error('No autorizado')
  }
  return profile
}

// ---------------------------------------------------------------------------
// Unidad
// ---------------------------------------------------------------------------

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

const unitSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Ponle un nombre').max(80),
  slug: z.string().trim().max(60).or(z.literal('')),
  description: z.string().trim().max(2000).or(z.literal('')),
  maxGuests: z.coerce.number().int().min(1).max(30),
  bedrooms: z.coerce.number().int().min(0).max(20),
  beds: z.coerce.number().int().min(0).max(40),
  bathrooms: z.coerce.number().min(0).max(20),
  basePrice: z.coerce.number().min(0, 'El precio no puede ser negativo'),
  minNights: z.coerce.number().int().min(1).max(365),
  maxNights: z.coerce.number().int().min(0).max(365),
  advanceNotice: z.coerce.number().int().min(0).max(365),
  sortOrder: z.coerce.number().int().min(0).max(999),
  isPublished: z.coerce.boolean(),
})

export async function saveUnit(_prev: UnitState, formData: FormData): Promise<UnitState> {
  await requireStaff()

  const parsed = unitSchema.safeParse({
    id: formData.get('id') ?? '',
    name: formData.get('name'),
    slug: formData.get('slug') ?? '',
    description: formData.get('description') ?? '',
    maxGuests: formData.get('maxGuests'),
    bedrooms: formData.get('bedrooms'),
    beds: formData.get('beds'),
    bathrooms: formData.get('bathrooms'),
    basePrice: formData.get('basePrice'),
    minNights: formData.get('minNights') || 1,
    maxNights: formData.get('maxNights') || 0,
    advanceNotice: formData.get('advanceNotice') || 0,
    sortOrder: formData.get('sortOrder') || 0,
    isPublished: formData.get('isPublished') === 'on',
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const slug = slugify(d.slug || d.name)
  if (!slug) return { error: 'El nombre no produce una dirección válida.' }

  if (d.maxNights > 0 && d.maxNights < d.minNights) {
    return { error: 'El máximo de noches no puede ser menor que el mínimo.' }
  }

  const supabase = await createClient()

  const row = {
    name: d.name,
    slug,
    description: d.description || null,
    max_guests: d.maxGuests,
    bedrooms: d.bedrooms,
    beds: d.beds,
    bathrooms: d.bathrooms,
    base_price_usd: d.basePrice,
    min_nights: d.minNights,
    // 0 en el formulario significa «sin máximo».
    max_nights: d.maxNights > 0 ? d.maxNights : null,
    advance_notice_days: d.advanceNotice,
    sort_order: d.sortOrder,
    is_published: d.isPublished,
  }

  let unitId = d.id || null

  if (unitId) {
    const { error } = await supabase.from('units').update(row).eq('id', unitId)
    if (error) {
      return {
        error: error.code === '23505'
          ? 'Ya existe otra unidad con esa dirección.'
          : 'No se pudo guardar la unidad.',
      }
    }
  } else {
    // Toda unidad cuelga de una propiedad; con un solo negocio hay una sola.
    const { data: property } = await supabase
      .from('properties')
      .select('id')
      .order('created_at')
      .limit(1)
      .maybeSingle()

    if (!property) return { error: 'No hay ninguna propiedad creada.' }

    const { data, error } = await supabase
      .from('units')
      .insert({ ...row, property_id: property.id })
      .select('id')
      .single()

    if (error) {
      return {
        error: error.code === '23505'
          ? 'Ya existe otra unidad con esa dirección.'
          : 'No se pudo crear la unidad.',
      }
    }
    unitId = data.id
  }

  revalidatePath('/admin/unidades')
  revalidatePath('/', 'layout')

  return { ok: d.id ? 'Unidad actualizada.' : 'Unidad creada.' }
}

export async function deleteUnit(_prev: UnitState, formData: FormData): Promise<UnitState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Unidad no válida.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_delete_unit', { p_unit_id: id.data })

  if (error) return { error: 'No se pudo eliminar.' }

  const result = data as { ok: boolean; error?: string; bookings?: number }

  if (!result.ok) {
    if (result.error === 'has_bookings') {
      return {
        error:
          `Tiene ${result.bookings} reserva${result.bookings === 1 ? '' : 's'} asociada` +
          `${result.bookings === 1 ? '' : 's'}. Despublícala en lugar de borrarla: ` +
          'borrarla perdería el historial de quién se alojó y qué pagó.',
      }
    }
    return { error: 'No se pudo eliminar.' }
  }

  revalidatePath('/admin/unidades')
  revalidatePath('/', 'layout')

  return { ok: 'Unidad eliminada.' }
}

// ---------------------------------------------------------------------------
// Amenidades
// ---------------------------------------------------------------------------

export async function setAmenities(_prev: UnitState, formData: FormData): Promise<UnitState> {
  await requireStaff()

  const unitId = z.string().uuid().safeParse(formData.get('unitId'))
  if (!unitId.success) return { error: 'Unidad no válida.' }

  const selected = formData.getAll('amenity').map(String)
  const supabase = await createClient()

  // Se reemplaza el conjunto entero: más simple y sin estados intermedios raros
  // que calcular altas y bajas por separado.
  await supabase.from('unit_amenities').delete().eq('unit_id', unitId.data)

  if (selected.length > 0) {
    const { error } = await supabase
      .from('unit_amenities')
      .insert(selected.map((amenity_id) => ({ unit_id: unitId.data, amenity_id })))

    if (error) return { error: 'No se pudieron guardar las amenidades.' }
  }

  revalidatePath('/admin/unidades')
  revalidatePath('/', 'layout')

  return { ok: 'Amenidades guardadas.' }
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

export async function uploadPhoto(_prev: UnitState, formData: FormData): Promise<UnitState> {
  await requireStaff()

  const unitId = z.string().uuid().safeParse(formData.get('unitId'))
  if (!unitId.success) return { error: 'Unidad no válida.' }

  const photo = formData.get('photo')
  if (!(photo instanceof File) || photo.size === 0) {
    return { error: 'Elige una imagen.' }
  }

  if (!ALLOWED_TYPES.includes(photo.type)) {
    return { error: 'Debe ser una imagen JPG, PNG o WebP.' }
  }

  if (photo.size > MAX_PHOTO_BYTES) {
    return {
      error: `Pesa ${Math.round(photo.size / 1024)} KB y el máximo es ` +
        `${MAX_PHOTO_BYTES / 1024} KB. Prueba con una imagen más pequeña.`,
    }
  }

  const supabase = await createClient()
  const admin = createAdminClient()
  const path = `${unitId.data}/${randomUUID()}.${EXTENSIONS[photo.type]}`

  const { error: uploadError } = await admin.storage
    .from(MEDIA_BUCKET)
    .upload(path, photo, { contentType: photo.type, upsert: false })

  if (uploadError) return { error: 'No se pudo subir la imagen.' }

  /*
    El tope y el `sort_order` los resuelve la base en una sola sentencia.

    Contarlas aquí y después insertar deja una carrera entre las dos consultas:
    con selección múltiple dos fotos podían leer el mismo máximo y acabar con el
    mismo número, o pasar las dos un tope que solo admitía una más.
  */
  const { data, error } = await supabase.rpc('staff_add_photo', {
    p_unit_id: unitId.data,
    p_path: path,
    p_max: MAX_PHOTOS_PER_UNIT,
  })

  const result = data as { ok: boolean; error?: string; max?: number } | null

  if (error || !result?.ok) {
    // Sin fila, el archivo quedaría ocupando cuota sin que nada lo referencie.
    await admin.storage.from(MEDIA_BUCKET).remove([path])

    if (result?.error === 'too_many') {
      return {
        error:
          `Esta unidad ya tiene ${result.max} fotos, que es el máximo. ` +
          'Borra alguna para subir otra.',
      }
    }
    return { error: 'No se pudo registrar la imagen.' }
  }

  revalidatePath('/admin/unidades')
  revalidatePath('/', 'layout')

  return { ok: 'Imagen subida.' }
}

/** Marca una foto como portada. La anterior deja de serlo. */
export async function setCover(_prev: UnitState, formData: FormData): Promise<UnitState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Imagen no válida.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_set_cover', { p_media_id: id.data })

  const result = data as { ok: boolean; error?: string } | null
  if (error || !result?.ok) return { error: 'No se pudo cambiar la portada.' }

  revalidatePath('/admin/unidades')
  revalidatePath('/', 'layout')

  return { ok: 'Portada cambiada.' }
}

export async function deletePhoto(_prev: UnitState, formData: FormData): Promise<UnitState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Imagen no válida.' }

  const supabase = await createClient()

  const { data: media } = await supabase
    .from('unit_media')
    .select('storage_path')
    .eq('id', id.data)
    .maybeSingle()

  const { error } = await supabase.from('unit_media').delete().eq('id', id.data)
  if (error) return { error: 'No se pudo eliminar.' }

  // El archivo se borra después de la fila: si esto falla queda un huérfano,
  // pero al revés quedaría una foto rota en el catálogo.
  if (media?.storage_path) {
    await createAdminClient().storage.from(MEDIA_BUCKET).remove([media.storage_path])
  }

  revalidatePath('/admin/unidades')
  revalidatePath('/', 'layout')

  return { ok: 'Imagen eliminada.' }
}

/** Intercambia el orden con la foto vecina. */
export async function movePhoto(_prev: UnitState, formData: FormData): Promise<UnitState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  const direction = formData.get('direction') === 'up' ? 'up' : 'down'
  if (!id.success) return { error: 'Imagen no válida.' }

  const supabase = await createClient()

  const { data: current } = await supabase
    .from('unit_media')
    .select('id, unit_id, sort_order')
    .eq('id', id.data)
    .maybeSingle()

  if (!current) return { error: 'Imagen no encontrada.' }

  const { data: neighbour } = await supabase
    .from('unit_media')
    .select('id, sort_order')
    .eq('unit_id', current.unit_id)
    [direction === 'up' ? 'lt' : 'gt']('sort_order', current.sort_order)
    .order('sort_order', { ascending: direction !== 'up' })
    .limit(1)
    .maybeSingle()

  if (!neighbour) return {}

  await supabase
    .from('unit_media')
    .update({ sort_order: neighbour.sort_order })
    .eq('id', current.id)
  await supabase
    .from('unit_media')
    .update({ sort_order: current.sort_order })
    .eq('id', neighbour.id)

  revalidatePath('/admin/unidades')
  revalidatePath('/', 'layout')

  return {}
}
