import { z } from 'zod'

import { BUSINESS_TZ } from '@/lib/timezone'

// Variables públicas. Next las inlinea en el bundle del cliente, así que hay
// que referenciarlas por su nombre completo y literal — no con índices
// dinámicos, o el reemplazo en build no ocurre.
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),

  // Se quita la barra final: el resto del código concatena rutas directamente
  // (`${base}/reserva/${code}`), y con barra saldrían URLs con doble barra en
  // los correos y en el retorno de Stripe. Da igual cómo se escriba en Vercel.
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url()
    .default('http://localhost:3000')
    .transform((value) => value.replace(/\/+$/, '')),
})

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
})

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  BUSINESS_TIMEZONE: z.string().default(BUSINESS_TZ),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),

  // Opcionales: sin ellas la pasarela aparece como «faltan credenciales» en
  // ajustes y el resto de la app funciona igual. Ver src/lib/payment-providers.ts.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
})

type ServerEnv = z.infer<typeof serverSchema>

let cached: ServerEnv | null = null

/**
 * Env de servidor. Es una función, no una constante exportada, para que ningún
 * import accidental desde un componente cliente arrastre la secret key al
 * bundle: si esto se ejecutara en el navegador, lanza.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() no puede usarse en el cliente')
  }
  if (!cached) cached = serverSchema.parse(process.env)
  return cached
}
