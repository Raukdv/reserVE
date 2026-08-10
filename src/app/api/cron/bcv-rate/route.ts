import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { fetchAndStoreRate } from '@/lib/bcv'
import { createAdminClient } from '@/lib/supabase/server'

// Necesita el runtime de Node: la lectura de bcv.org.ve usa node:https para
// desactivar la verificación TLS solo en esa petición.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  // Vercel Cron manda `Authorization: Bearer <CRON_SECRET>` cuando la variable
  // está definida en el proyecto.
  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`

  // Comparación de tiempo constante: una comparación normal filtra el secreto
  // carácter a carácter ante un atacante que mida la latencia.
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  const force = request.nextUrl.searchParams.get('force') === '1'
  const result = await fetchAndStoreRate({ force })

  // Barrido de la bitácora en la misma corrida: evita un segundo cron, que el
  // plan Hobby no permitiría de todos modos.
  await createAdminClient().rpc('prune_rate_fetch_log')

  // Un fallo devuelve 200 a propósito. La corrida SÍ tocó la base —que es lo que
  // impide la pausa por inactividad de Supabase— y Vercel reintentaría en balde
  // ante un 500: si el BCV no publicó, no va a publicar por reintentar. El
  // resultado real va en el cuerpo y queda en rate_fetch_log.
  return NextResponse.json(result)
}
