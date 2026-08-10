// Revisa .env.local: que estén las variables y que tengan la pinta correcta.
//
//   npm run env:check
//
// Existe por un pegado truncado del secreto de Stripe que costó un rato
// encontrar: el prefijo coincidía, así que a ojo parecía bien, pero le faltaba
// un carácter y todos los webhooks devolvían 400. Comprobar la longitud tarda
// un milisegundo y ahorra esa persecución.
//
// La ruta del archivo se resuelve respecto a este script, no al directorio desde
// el que se invoca.

import { readFileSync } from 'node:fs'

let raw
try {
  raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
} catch {
  console.error('No existe .env.local. Cópialo de .env.example y rellénalo.')
  process.exit(1)
}

const env = {}
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const hex = (n) => (v) =>
  new RegExp(`^[0-9a-f]{${n}}$`).test(v) || `deben ser ${n} caracteres hexadecimales, hay ${v.length}`

const checks = [
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    required: true,
    test: (v) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v) || 'debe ser https://<ref>.supabase.co',
  },
  {
    key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    required: true,
    test: (v) => v.startsWith('sb_publishable_') || 'debe empezar por sb_publishable_',
  },
  {
    key: 'SUPABASE_SECRET_KEY',
    required: true,
    secret: true,
    test: (v) => v.startsWith('sb_secret_') || 'debe empezar por sb_secret_',
  },
  {
    key: 'SUPABASE_DB_URL',
    required: true,
    secret: true,
    test: (v) =>
      v.startsWith('postgresql://') ||
      'debe ser una cadena postgresql://. Usa el session pooler, no la conexión directa',
  },
  {
    key: 'NEXT_PUBLIC_SITE_URL',
    required: true,
    test: (v) => /^https?:\/\//.test(v) || 'debe ser una URL completa',
  },
  {
    key: 'CRON_SECRET',
    required: true,
    secret: true,
    test: (v) => v.length >= 32 || `demasiado corto (${v.length}), usa al menos 32 caracteres`,
  },
  {
    key: 'RESEND_API_KEY',
    required: false,
    secret: true,
    test: (v) => v.startsWith('re_') || 'debe empezar por re_',
    missing: 'sin esto no se envía ningún correo',
  },
  {
    key: 'RESEND_FROM_EMAIL',
    required: false,
    test: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || 'no parece un correo',
  },
  {
    key: 'STRIPE_SECRET_KEY',
    required: false,
    secret: true,
    test: (v) =>
      v.startsWith('sk_test_')
        ? true
        : v.startsWith('sk_live_')
          ? 'ES CLAVE REAL — en desarrollo debe ser sk_test_'
          : 'debe empezar por sk_test_',
    missing: 'el pago con tarjeta aparecerá como no disponible',
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    required: false,
    secret: true,
    // Aquí estaba el fallo real: el prefijo coincidía y el cuerpo venía cortado.
    test: (v) => {
      if (!v.startsWith('whsec_')) return 'debe empezar por whsec_'
      const body = v.slice(6)
      if (body.length !== 32 && body.length !== 64) {
        return `cuerpo de ${body.length} caracteres; deben ser 32 o 64 — pegado incompleto`
      }
      return hex(body.length)(body)
    },
    missing: 'los webhooks de Stripe se rechazarán',
  },
]

let errors = 0
let warnings = 0

for (const { key, required, secret, test, missing } of checks) {
  const value = env[key]

  if (!value) {
    if (required) {
      console.log(` FALTA  ${key}`)
      errors++
    } else {
      console.log(`  aviso ${key} sin definir${missing ? ` — ${missing}` : ''}`)
      warnings++
    }
    continue
  }

  const result = test(value)
  if (result === true) {
    const shown = secret ? `${value.slice(0, 10)}… (${value.length})` : value
    console.log(`  ok    ${key}  ${shown}`)
  } else {
    console.log(` FALLA  ${key} — ${result}`)
    errors++
  }
}

console.log(
  errors
    ? `\n${errors} problema(s). La app no funcionará bien hasta corregirlos.`
    : warnings
      ? `\nSin errores. ${warnings} variable(s) opcional(es) sin definir.`
      : '\nTodo correcto.',
)

process.exit(errors ? 1 : 0)
