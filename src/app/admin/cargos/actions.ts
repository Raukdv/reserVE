'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getProfile } from '@/lib/supabase/server'

export type FeeState = { error?: string; ok?: string }

async function requireStaff() {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    throw new Error('No autorizado')
  }
}

const feeSchema = z
  .object({
    id: z.string().uuid().optional().or(z.literal('')),
    // Vacío = cargo general, a todas las unidades.
    unitId: z.string().uuid().optional().or(z.literal('')),
    name: z.string().trim().min(2, 'Ponle un nombre al cargo').max(60),
    kind: z.enum(['fixed', 'per_night', 'per_guest', 'percent']),
    amount: z.coerce.number().min(0, 'No puede ser negativo'),
    description: z.string().trim().max(200).or(z.literal('')),
    refundable: z.coerce.boolean(),
    isActive: z.coerce.boolean(),
    sortOrder: z.coerce.number().int().min(0).max(99),
  })
  .refine((d) => d.kind !== 'percent' || d.amount <= 100, {
    message: 'Un porcentaje no puede pasar de 100',
    path: ['amount'],
  })

export async function saveFee(_prev: FeeState, formData: FormData): Promise<FeeState> {
  await requireStaff()

  const parsed = feeSchema.safeParse({
    id: formData.get('id') ?? '',
    unitId: formData.get('unitId') ?? '',
    name: formData.get('name'),
    kind: formData.get('kind'),
    amount: formData.get('amount'),
    description: formData.get('description') ?? '',
    refundable: formData.get('refundable') === 'on',
    isActive: formData.get('isActive') === 'on',
    sortOrder: formData.get('sortOrder') || 0,
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const supabase = await createClient()

  const row = {
    unit_id: d.unitId || null,
    name: d.name,
    kind: d.kind,
    amount: d.amount,
    description: d.description || null,
    // Un porcentaje sigue a su base y se reembolsa en proporción; la bandera no
    // le aplica, así que se guarda en falso para no sugerir lo contrario.
    refundable: d.kind === 'percent' ? false : d.refundable,
    is_active: d.isActive,
    sort_order: d.sortOrder,
  }

  const { error } = d.id
    ? await supabase.from('fees').update(row).eq('id', d.id)
    : await supabase.from('fees').insert(row)

  if (error) return { error: 'No se pudo guardar el cargo.' }

  // Cambian los precios que ve el público.
  revalidatePath('/', 'layout')
  revalidatePath('/admin/cargos')
  revalidatePath('/admin/unidades', 'layout')

  return { ok: d.id ? 'Cargo actualizado.' : 'Cargo añadido.' }
}

export async function deleteFee(_prev: FeeState, formData: FormData): Promise<FeeState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Cargo no válido.' }

  const supabase = await createClient()
  const { error } = await supabase.from('fees').delete().eq('id', id.data)

  if (error) return { error: 'No se pudo eliminar.' }

  // Las reservas ya hechas conservan su desglose congelado, así que borrar un
  // cargo no altera lo cobrado.
  revalidatePath('/', 'layout')
  revalidatePath('/admin/cargos')
  revalidatePath('/admin/unidades', 'layout')

  return { ok: 'Cargo eliminado.' }
}
