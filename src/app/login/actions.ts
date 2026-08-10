'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const credentials = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  next: z.string().startsWith('/').default('/admin'),
})

export type LoginState = { error?: string }

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  // Mensaje genérico a propósito: distinguir "correo no existe" de "contraseña
  // incorrecta" permite enumerar usuarios registrados.
  if (error) return { error: 'Credenciales incorrectas' }

  revalidatePath('/', 'layout')
  redirect(parsed.data.next)
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
