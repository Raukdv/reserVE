'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const ISO = /^\d{4}-\d{2}-\d{2}$/

const blockSchema = z.object({
  unitId: z.string().uuid('Elige una unidad'),
  from: z.string().regex(ISO, 'Revisa la fecha de inicio'),
  to: z.string().regex(ISO, 'Revisa la fecha de fin'),
  reason: z.string().trim().max(200).optional().or(z.literal('')),
})

const ERRORS: Record<string, string> = {
  forbidden: 'No tienes permiso para bloquear fechas.',
  invalid_dates: 'La fecha de fin debe ser posterior a la de inicio.',
  unit_not_found: 'Esa unidad ya no existe.',
  occupied: 'Ya hay una reserva o un bloqueo en esas fechas.',
  not_found: 'Ese bloqueo ya no existe.',
  not_a_block: 'Eso es una reserva: cancélala desde su ficha, no desde aquí.',
}

export type BlockState = { error?: string; ok?: string }

/**
 * Bloquea un rango de fechas.
 *
 * El rango es semiabierto, igual que en las reservas: el día de fin queda libre.
 * Bloquear del 10 al 14 inutiliza las noches 10, 11, 12 y 13, y el 14 se puede
 * vender como entrada.
 */
export async function createBlock(
  _prev: BlockState,
  formData: FormData,
): Promise<BlockState> {
  const parsed = blockSchema.safeParse({
    unitId: formData.get('unitId'),
    from: formData.get('from'),
    to: formData.get('to'),
    reason: formData.get('reason'),
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_block', {
    p_unit_id: d.unitId,
    p_from: d.from,
    p_to: d.to,
    p_reason: d.reason || null,
  })

  if (error) return { error: 'No se pudo bloquear. Inténtalo de nuevo.' }

  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { error: ERRORS[result.error ?? ''] ?? 'No se pudo bloquear.' }

  revalidatePath('/admin/calendario')
  revalidatePath('/alojamientos', 'layout')

  return { ok: 'Fechas bloqueadas.' }
}

export async function releaseBlock(
  _prev: BlockState,
  formData: FormData,
): Promise<BlockState> {
  const holdId = z.string().uuid().safeParse(formData.get('holdId'))
  if (!holdId.success) return { error: 'Bloqueo no válido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('release_block', { p_hold_id: holdId.data })

  if (error) return { error: 'No se pudo liberar.' }

  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { error: ERRORS[result.error ?? ''] ?? 'No se pudo liberar.' }

  revalidatePath('/admin/calendario')
  revalidatePath('/alojamientos', 'layout')

  return { ok: 'Fechas liberadas.' }
}
