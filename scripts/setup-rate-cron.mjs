/**
 * Siembra en Supabase Vault los secretos que necesita `cron_ping_rate()`.
 *
 * La migración `0034` crea la función y el horario, pero no los valores: en un
 * archivo versionado no van secretos. Esto los lee de `.env.local` y los mete
 * cifrados.
 *
 *   node --env-file=.env.local scripts/setup-rate-cron.mjs
 *
 * Es idempotente: si el secreto ya existe lo actualiza. Ejecutarlo de nuevo tras
 * rotar el `CRON_SECRET` es justamente lo que hay que hacer.
 */
import { Client } from 'pg'

const SECRETOS = [
  {
    name: 'cron_secret',
    env: 'CRON_SECRET',
    description: 'Bearer con el que cron_ping_rate() llama a /api/cron/daily',
  },
  {
    name: 'site_url',
    env: 'NEXT_PUBLIC_SITE_URL',
    description: 'Origen del despliegue al que apunta el sondeo de tasa',
  },
]

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

try {
  for (const { name, env, description } of SECRETOS) {
    const valor = process.env[env]
    if (!valor) {
      console.error(`falta ${env} en el entorno`)
      process.exitCode = 1
      continue
    }

    const { rows } = await client.query(
      'select id from vault.secrets where name = $1',
      [name],
    )

    if (rows.length) {
      await client.query('select vault.update_secret($1, $2, $3, $4)', [
        rows[0].id, valor, name, description,
      ])
      console.log(`actualizado  ${name}`)
    } else {
      await client.query('select vault.create_secret($1, $2, $3)', [
        valor, name, description,
      ])
      console.log(`creado       ${name}`)
    }
  }

  // Comprobar que descifra y que la URL es la esperada. El secreto no se
  // imprime; la URL sí, porque apuntar al despliegue equivocado es el fallo
  // silencioso más probable de todo esto.
  const { rows: [check] } = await client.query(`
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'site_url')  as url,
      (select length(decrypted_secret) from vault.decrypted_secrets where name = 'cron_secret') as largo
  `)
  console.log(`\nsondeo apuntando a  ${check.url}/api/cron/daily?only=rate`)
  console.log(`CRON_SECRET de ${check.largo} caracteres, legible desde Vault`)

  const { rows: [job] } = await client.query(
    `select schedule, active from cron.job where jobname = 'fetch-bcv-rate'`,
  )
  console.log(
    job
      ? `tarea fetch-bcv-rate  ${job.schedule}  activa=${job.active}`
      : 'tarea fetch-bcv-rate ausente — falta aplicar la migración 0034',
  )
} finally {
  await client.end()
}
