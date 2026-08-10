import { z } from 'zod'

// Variables públicas. Next las inlinea en el bundle del cliente, así que hay
// que referenciarlas por su nombre completo y literal — no con índices
// dinámicos, o el reemplazo en build no ocurre.
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
})

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
})

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  BUSINESS_TIMEZONE: z.string().default('America/Caracas'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
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
