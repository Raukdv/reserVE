import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { fetchAndStoreRate } from '@/lib/bcv'
import { sendArrivalReminder } from '@/lib/email'
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

/**
 * Trabajo diario. Un solo cron para todo, porque el plan Hobby de Vercel admite
 * únicamente frecuencia diaria y no conviene gastar más de una entrada.
 *
 * Hace tres cosas:
 *   1. Tasa BCV del día. Es también el latido que evita la pausa por inactividad
 *      de siete días del plan gratuito de Supabase, así que debe correr aunque el
 *      BCV no publique — fines de semana y feriados incluidos.
 *   2. Recordatorios a quien llega mañana.
 *   3. Poda de bitácoras, para no crecer sin techo contra los 500 MB gratuitos.
 *
 * Con `?only=rate` hace solo lo primero. La tasa hay que releerla varias veces
 * al día — la última publicada por el BCV es la legal desde ese instante, y
 * cierra entre las 6 y las 8 de la tarde — mientras que los recordatorios y la
 * poda son de una vez al día. El sondeo frecuente entra por ahí y no arrastra
 * el resto del trabajo detrás.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  const force = request.nextUrl.searchParams.get('force') === '1'
  const rate = await fetchAndStoreRate({ force })

  if (request.nextUrl.searchParams.get('only') === 'rate') {
    return NextResponse.json({ ok: true, rate })
  }

  const supabase = createAdminClient()

  // La consulta excluye a quien ya recibió el recordatorio, y un índice único
  // sobre (booking_id, kind) lo garantiza aunque el cron se ejecute dos veces.
  const { data: arrivals } = await supabase.rpc('bookings_arriving_tomorrow')
  const { data: settings } = await supabase
    .from('app_settings')
    .select('business_name, default_deposit_ratio')
    .single()

  let sent = 0
  for (const a of arrivals ?? []) {
    const ok = await sendArrivalReminder({
      id: a.id,
      code: a.code,
      guestName: a.guest_name,
      guestEmail: a.guest_email,
      unitName: a.unit_name,
      checkIn: a.check_in,
      checkOut: a.check_out,
      totalUsd: Number(a.total_usd),
      depositUsd: Number(a.total_usd) * Number(settings?.default_deposit_ratio ?? 0.3),
      paidUsd: Number(a.paid_usd),
      businessName: settings?.business_name ?? 'reserVE',
      pending: Math.max(0, Number(a.total_usd) - Number(a.paid_usd)),
    })
    if (ok) sent++
  }

  await Promise.all([
    supabase.rpc('prune_rate_fetch_log'),
    supabase.rpc('prune_email_log'),
  ])

  // Un fallo devuelve 200 a propósito. La corrida SÍ tocó la base —que es lo que
  // impide la pausa por inactividad de Supabase— y Vercel reintentaría en balde
  // ante un 500: si el BCV no publicó, no va a publicar por reintentar. El
  // resultado real va en el cuerpo y queda en rate_fetch_log y email_log.
  return NextResponse.json({
    rate,
    reminders: { candidates: arrivals?.length ?? 0, sent },
  })
}
