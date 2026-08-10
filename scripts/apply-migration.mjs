// Aplica un archivo de migración contra la base enlazada.
//
//   node scripts/apply-migration.mjs supabase/migrations/0002_....sql
//
// Existe porque la CLI de Supabase necesita Docker para `db push` y aquí no lo
// hay. Todo el archivo va en una transacción: o entra completo o no entra nada.

import { readFileSync } from 'node:fs'
import pg from 'pg'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const file = process.argv[2]
if (!file) {
  console.error('Uso: node scripts/apply-migration.mjs <ruta.sql>')
  process.exit(1)
}

const sql = readFileSync(file, 'utf8')

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
try {
  await client.query('begin')
  await client.query(sql)
  await client.query('commit')
  console.log(`Aplicada: ${file}`)
} catch (err) {
  await client.query('rollback')
  console.error(`Falló, nada se aplicó: ${err.message}`)
  if (err.position) console.error(`  posición ${err.position}`)
  process.exitCode = 1
} finally {
  await client.end()
}
