// Dispara el alimentador de tasa BCV contra la app.
//
//   npm run rate:fetch                      -> http://localhost:3000
//   npm run rate:fetch -- --url=http://localhost:3001
//   npm run rate:fetch -- --url=https://reserve.lngeneralservices.com --force
//
// Es un disparador, no una implementación: la lógica vive en src/lib/bcv.ts y
// la ejecuta /api/cron/bcv-rate. Así lo que se prueba en local es exactamente
// el mismo código que corre el cron de Vercel, sin una segunda versión que se
// desincronice.
//
// Requiere la app corriendo.

import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:3000'
const force = args.includes('--force')

const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('Falta CRON_SECRET en .env.local')
  process.exit(1)
}

const url = `${base.replace(/\/$/, '')}/api/cron/bcv-rate${force ? '?force=1' : ''}`

let res
try {
  res = await fetch(url, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(60_000),
  })
} catch (err) {
  console.error(`No se pudo alcanzar ${url}`)
  console.error(`  ${err.message}`)
  console.error('  ¿Está la app corriendo? Usa --url= si escucha en otro puerto.')
  process.exit(1)
}

if (res.status === 401) {
  console.error('401 — el CRON_SECRET del script no coincide con el de la app.')
  process.exit(1)
}

const body = await res.json().catch(() => null)

if (!body) {
  console.error(`Respuesta no interpretable (HTTP ${res.status})`)
  process.exit(1)
}

if (body.ok) {
  console.log(
    `${body.rateDate} → ${body.usdVes} Bs/USD (${body.source})` +
    `${body.changed ? '' : ' — sin cambio'}`,
  )
} else {
  console.error(`No se guardó: ${body.detail}`)
  process.exitCode = 1
}
