'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { createClient, createAdminClient, getProfile } from '@/lib/supabase/server'
import { MAX_PHOTO_BYTES, MAX_SITE_PHOTOS_PER_SECTION } from '@/lib/media-limits'
import { SITE_IMAGE_SECTIONS, SITE_SECTION_KEYS, type SiteSectionKey } from '@/lib/site-sections'
import type { Json } from '@/types/database'

export type ContentState = { error?: string; ok?: string }

async function requireStaff() {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    throw new Error('No autorizado')
  }
  return profile
}

/**
 * Guarda una sección del home.
 *
 * Cada sección es un objeto JSON con su propia forma, así que la validación va
 * por clave. Un esquema por sección evita que un campo mal nombrado se guarde en
 * silencio y la web deje de mostrarlo sin dar error.
 */
const SECTIONS = {
  hero: z.object({
    title: z.string().trim().max(120),
    subtitle: z.string().trim().max(400),
  }),
  about: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().max(4000),
  }),
  services: z.object({
    title: z.string().trim().max(120),
    items: z.array(
      z.object({
        label: z.string().trim().min(1).max(80),
        detail: z.string().trim().max(200),
      }),
    ),
  }),
  location: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().max(2000),
    address: z.string().trim().max(200),
    /*
      Coordenadas del mapa. Vacías si no se ponen: el rango se valida para que
      un dedo torpe no mande el mapa al océano, y se guardan como número para no
      tener que reinterpretar una cadena en cada render.
    */
    lat: z.coerce.number().min(-90).max(90).or(z.literal('')).optional(),
    lng: z.coerce.number().min(-180).max(180).or(z.literal('')).optional(),
  }),
  faq: z.object({
    title: z.string().trim().max(120),
    items: z.array(
      z.object({
        q: z.string().trim().min(1).max(200),
        a: z.string().trim().max(1500),
      }),
    ),
  }),
  contact: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().max(1000),
  }),

  // Textos legales. Van en la base y no en el código porque son vinculantes y
  // los edita el negocio, no quien programa. Una línea en blanco separa párrafos.
  legal_condiciones: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().max(20000),
  }),
  // `legal_cancelacion` ya no está: la política se publica generada desde los
  // tramos de reembolso y se edita en Ajustes. Dejar aquí el esquema volvería a
  // abrir la puerta a un texto que contradijera el cálculo.
  legal_privacidad: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().max(20000),
  }),
} as const

export type SectionKey = keyof typeof SECTIONS

export async function saveSection(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const staff = await requireStaff()

  const key = String(formData.get('key') ?? '') as SectionKey
  const schema = SECTIONS[key]
  if (!schema) return { error: 'Sección desconocida.' }

  // Las listas viajan como JSON en un campo oculto; el resto son campos sueltos.
  const raw: Record<string, unknown> = {}
  for (const [name, value] of formData.entries()) {
    if (name === 'key' || typeof value !== 'string') continue
    raw[name] = name === 'items' ? safeParse(value) : value
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { error: `${issue.path.join('.') || 'campo'}: ${issue.message}` }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('site_content').upsert(
    {
      key,
      data: parsed.data as Json,
      updated_by: staff.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )

  if (error) return { error: 'No se pudo guardar.' }

  revalidatePath('/')
  revalidatePath('/admin/contenido')

  return { ok: 'Guardado.' }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Fotos de las secciones del sitio
// ---------------------------------------------------------------------------

const SITE_BUCKET = 'site-media'


const ALLOWED_TYPES = ['image/webp', 'image/jpeg', 'image/png']
const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/**
 * Sube una foto a una sección del sitio.
 *
 * Estas fotos representan al negocio —la casa, la terraza, el entorno— y no a
 * ninguna unidad. Por eso viven en su propio bucket y en `site_media`, con la
 * misma clave de sección que el texto.
 */
export async function uploadSiteImage(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireStaff()

  // Sin destino: se elige después, en la propia galería.
  const section = 'sin_asignar'

  const photo = formData.get('image')
  if (!(photo instanceof File) || photo.size === 0) return { error: 'Elige una imagen.' }

  if (!ALLOWED_TYPES.includes(photo.type)) {
    return { error: 'Debe ser una imagen JPG, PNG o WebP.' }
  }

  if (photo.size > MAX_PHOTO_BYTES) {
    return {
      error:
        `Pesa ${Math.round(photo.size / 1024)} KB y el máximo es ` +
        `${MAX_PHOTO_BYTES / 1024} KB. Prueba con una imagen más pequeña.`,
    }
  }

  const supabase = await createClient()
  const admin = createAdminClient()
  const path = `${section}/${randomUUID()}.${EXTENSIONS[photo.type]}`

  const { error: uploadError } = await admin.storage
    .from(SITE_BUCKET)
    .upload(path, photo, { contentType: photo.type, upsert: false })

  if (uploadError) return { error: 'No se pudo subir la imagen.' }

  // El tope y el orden los resuelve la base en una sentencia, igual que en las
  // fotos de unidad: contarlas aquí y luego insertar deja una carrera.
  const { data, error } = await supabase.rpc('staff_add_site_image', {
    p_section: section,
    p_path: path,
    p_max: MAX_SITE_PHOTOS_PER_SECTION,
  })

  const result = data as { ok: boolean; error?: string; max?: number } | null

  if (error || !result?.ok) {
    // Sin fila, el archivo ocuparía cuota sin que nada lo referencie.
    await admin.storage.from(SITE_BUCKET).remove([path])

    if (result?.error === 'too_many') {
      return {
        error: `Esta sección ya tiene ${result.max} fotos, que es el máximo.`,
      }
    }
    return { error: 'No se pudo registrar la imagen.' }
  }

  revalidatePath('/admin/contenido')
  revalidatePath('/', 'layout')

  return { ok: 'Imagen subida.' }
}

/** Borra una foto de sección, del registro y del almacén. */
export async function deleteSiteImage(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Imagen no válida.' }

  const supabase = await createClient()

  const { data: media } = await supabase
    .from('site_media')
    .select('storage_path')
    .eq('id', id.data)
    .maybeSingle()

  const { error } = await supabase.from('site_media').delete().eq('id', id.data)
  if (error) return { error: 'No se pudo eliminar.' }

  // Se borra el archivo después de la fila: al revés, un fallo al borrar la fila
  // dejaría una imagen rota en la web.
  if (media?.storage_path) {
    await createAdminClient().storage.from(SITE_BUCKET).remove([media.storage_path])
  }

  revalidatePath('/admin/contenido')
  revalidatePath('/', 'layout')

  return { ok: 'Imagen eliminada.' }
}

/** Cambia a qué sección de la web pertenece una foto. */
export async function setSiteImageSection(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  const section = String(formData.get('section') ?? '')

  if (!id.success) return { error: 'Imagen no válida.' }
  if (!SITE_SECTION_KEYS.includes(section as SiteSectionKey)) {
    return { error: 'Sección no válida.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_move_site_image', {
    p_id: id.data,
    p_section: section,
  })

  const result = data as { ok: boolean } | null
  if (error || !result?.ok) return { error: 'No se pudo mover la imagen.' }

  revalidatePath('/admin/contenido')
  revalidatePath('/', 'layout')

  const label = SITE_IMAGE_SECTIONS.find((s) => s.key === section)?.label ?? section
  return { ok: `Movida a ${label}.` }
}
