import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { publicEnv, serverEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Cliente con la sesión del usuario. Respeta RLS — es el que se usa por defecto.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Los Server Components no pueden escribir cookies. El middleware
            // ya refresca la sesión, así que ignorar aquí es seguro.
          }
        },
      },
    },
  )
}

/**
 * Cliente con la secret key. SALTA RLS POR COMPLETO.
 *
 * Úsalo solo donde el servidor ya autorizó la operación por su cuenta: crear una
 * reserva de un huésped sin sesión, aprobar un pago tras verificar rol admin,
 * jobs de cron. Nunca lo pases a una ruta que reciba parámetros del cliente sin
 * validar quién es quien llama.
 */
export function createAdminClient() {
  const { SUPABASE_SECRET_KEY } = serverEnv()

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}

/** Usuario autenticado, o null. */
export async function getUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user
}

/** Perfil con rol, o null si no hay sesión. */
export async function getProfile() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null

  const { data } = await supabase
    .from('profiles')
    .select('id, role, full_name, phone, document_id')
    .eq('id', auth.user.id)
    .single()

  return data
}

export async function isStaff() {
  const profile = await getProfile()
  return profile?.role === 'admin' || profile?.role === 'staff'
}
