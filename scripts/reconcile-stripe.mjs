// Concilia cobros de Stripe que no llegaron a registrarse.
//
//   node scripts/reconcile-stripe.mjs           -> solo informa
//   node scripts/reconcile-stripe.mjs --apply   -> registra los que falten
//
// Un webhook puede no llegar: el endpoint estaba caído, apuntaba a otro sitio, o
// la CLI no estaba escuchando en local. Cuando eso pasa, el dinero se movió y la
// reserva se queda pendiente hasta que expira — el peor desenlace posible.
//
// Esta herramienta compara lo que Stripe dice haber cobrado contra lo que hay en
// la base y cierra la diferencia. Es idempotente: se apoya en el mismo índice
// único que protege al webhook, así que reejecutarla no duplica nada.

import { readFileSync } from 'node:fs'
import pg from 'pg'
import Stripe from 'stripe'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const APPLY = process.argv.includes('--apply')

const { STRIPE_SECRET_KEY, SUPABASE_DB_URL } = process.env
if (!STRIPE_SECRET_KEY) {
  console.error('Falta STRIPE_SECRET_KEY en .env.local')
  process.exit(1)
}

const stripe = new Stripe(STRIPE_SECRET_KEY)
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const sessions = await stripe.checkout.sessions.list({ limit: 100 })

const paid = sessions.data.filter(
  (s) => s.payment_status === 'paid' && s.client_reference_id,
)

console.log(`${paid.length} sesión(es) pagada(s) con código de reserva\n`)

let missing = 0
let recovered = 0

for (const session of paid) {
  const code = session.client_reference_id
  const amount = (session.amount_total ?? 0) / 100

  const { rows: existing } = await db.query(
    `select 1 from payments where provider = 'stripe' and provider_ref = $1`,
    [session.id],
  )

  if (existing.length > 0) continue

  const { rows: booking } = await db.query(
    `select status from bookings where code = $1`,
    [code],
  )

  if (booking.length === 0) {
    console.log(`  ${code}  ${amount} USD  — la reserva no existe, revisar a mano`)
    continue
  }

  missing++

  if (!APPLY) {
    console.log(
      `  ${code}  ${amount} USD  reserva ${booking[0].status}  → sin registrar (usa --apply)`,
    )
    continue
  }

  const { rows: [result] } = await db.query(
    `select record_gateway_payment($1,'stripe',$2,'tarjeta',$3,$4,$4,$5) as r`,
    [
      code,
      session.id,
      (session.currency ?? 'usd').toUpperCase(),
      amount,
      JSON.stringify({
        reconciled: true,
        payment_intent:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
        customer_email: session.customer_details?.email ?? null,
      }),
    ],
  )

  if (result.r?.ok) {
    recovered++
    console.log(
      `  ${code}  ${amount} USD  → registrado` +
      (result.r.confirmed ? ' y reserva confirmada' : ' (anticipo aún incompleto)'),
    )
  } else {
    console.log(`  ${code}  ${amount} USD  → FALLÓ: ${result.r?.error}`)
  }
}

await db.end()

if (missing === 0) {
  console.log('Todo cuadra: no falta ningún cobro por registrar.')
} else if (APPLY) {
  console.log(`\n${recovered} de ${missing} cobro(s) recuperado(s).`)
  console.log('Aviso: la conciliación NO envía el correo de pago aprobado.')
  console.log('Si hace falta, reenvía el enlace desde /admin/ajustes.')
} else {
  console.log(`\n${missing} cobro(s) sin registrar. Repite con --apply para cerrarlos.`)
}
