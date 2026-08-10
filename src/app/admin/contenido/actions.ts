'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getProfile } from '@/lib/supabase/server'
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
