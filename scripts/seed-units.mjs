/**
 * Unidades de prueba, para ver el calendario y el catálogo con volumen.
 *
 *   node --env-file=.env.local scripts/seed-units.mjs
 *   node --env-file=.env.local scripts/seed-units.mjs --limpiar
 *
 * Va aparte de `seed-revenue.mjs` a propósito: las unidades son configuración
 * del negocio, no movimiento. Borrar las reservas de prueba no debe llevarse por
 * delante unas unidades que a lo mejor el operador ya ajustó.
 *
 * `--limpiar` solo borra las que no tengan ninguna reserva. Una unidad con
 * historial no se puede eliminar —`bookings.unit_id` lo impide— y tampoco
 * debería: perdería el registro de quién se alojó y qué pagó. Si quedan, hay que
 * limpiar antes las reservas.
 */
import { Client } from 'pg'

/** Prefijo que marca lo sembrado. El resto de unidades no se tocan. */
const PREFIJO = 'prueba-'

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

/**
 * Quince unidades con precios y capacidades variados.
 *
 * No son quince clones: una posada real mezcla habitaciones sueltas con cabañas
 * y una casa entera, y esa dispersión de precios es lo que hace que la columna
 * de ingresos por unidad tenga algo que decir.
 */
const UNIDADES = [
  { nombre: 'Habitación Brisa',   precio: 65,  huespedes: 2, hab: 1, camas: 1, banos: 1 },
  { nombre: 'Habitación Arena',   precio: 70,  huespedes: 2, hab: 1, camas: 2, banos: 1 },
  { nombre: 'Habitación Caracol', precio: 72,  huespedes: 2, hab: 1, camas: 1, banos: 1 },
  { nombre: 'Habitación Sol',     precio: 78,  huespedes: 3, hab: 1, camas: 2, banos: 1 },
  { nombre: 'Habitación Luna',    precio: 80,  huespedes: 3, hab: 1, camas: 2, banos: 1 },
  { nombre: 'Cabaña Almendrón',   precio: 110, huespedes: 4, hab: 2, camas: 3, banos: 1 },
  { nombre: 'Cabaña Uvero',       precio: 115, huespedes: 4, hab: 2, camas: 3, banos: 1 },
  { nombre: 'Cabaña Mangle',      precio: 125, huespedes: 4, hab: 2, camas: 3, banos: 2 },
  { nombre: 'Cabaña Cocotero',    precio: 130, huespedes: 5, hab: 2, camas: 4, banos: 2 },
  { nombre: 'Bungalow Coral',     precio: 155, huespedes: 5, hab: 2, camas: 4, banos: 2 },
  { nombre: 'Bungalow Tortuga',   precio: 165, huespedes: 6, hab: 3, camas: 5, banos: 2 },
  { nombre: 'Suite Amanecer',     precio: 190, huespedes: 4, hab: 2, camas: 2, banos: 2 },
  { nombre: 'Suite Atardecer',    precio: 205, huespedes: 4, hab: 2, camas: 2, banos: 2 },
  { nombre: 'Casa Palmar',        precio: 280, huespedes: 8, hab: 4, camas: 6, banos: 3 },
  { nombre: 'Casa Mirador',       precio: 340, huespedes: 10, hab: 5, camas: 8, banos: 4 },
]

/** `Cabaña Almendrón` → `prueba-cabana-almendron`. */
const slugDe = (nombre) =>
  PREFIJO +
  nombre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

await client.connect()

try {
  if (process.argv.includes('--limpiar')) {
    const { rows: conReservas } = await client.query(
      `select u.name, count(b.id)::int as reservas
         from units u join bookings b on b.unit_id = u.id
        where u.slug like $1 group by u.name`,
      [`${PREFIJO}%`],
    )

    const { rowCount } = await client.query(
      `delete from units u
        where u.slug like $1
          and not exists (select 1 from bookings b where b.unit_id = u.id)`,
      [`${PREFIJO}%`],
    )

    console.log(`borradas ${rowCount} unidades de prueba`)
    if (conReservas.length) {
      console.log(
        `\nquedan ${conReservas.length} con reservas, que no se pueden borrar sin ` +
        'perder el historial. Limpia antes las reservas:\n' +
        '  node --env-file=.env.local scripts/seed-revenue.mjs --limpiar',
      )
      console.table(conReservas)
    }
    process.exit(0)
  }

  const { rows: [{ orden }] } = await client.query(
    'select coalesce(max(sort_order), 0)::int as orden from units',
  )

  let creadas = 0
  let existentes = 0

  for (const [i, u] of UNIDADES.entries()) {
    const slug = slugDe(u.nombre)

    const { rowCount } = await client.query(
      `insert into units (
         name, slug, description, base_price_usd, max_guests,
         bedrooms, beds, bathrooms, min_nights, advance_notice_days,
         is_published, sort_order
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 1, 0, true, $9)
       on conflict (slug) do nothing`,
      [
        u.nombre, slug,
        `${u.hab} habitación${u.hab === 1 ? '' : 'es'}, ${u.camas} cama${
          u.camas === 1 ? '' : 's'}, ${u.banos} baño${u.banos === 1 ? '' : 's'}. ` +
        `Hasta ${u.huespedes} huéspedes.`,
        u.precio, u.huespedes, u.hab, u.camas, u.banos, orden + i + 1,
      ],
    )

    if (rowCount > 0) creadas++
    else existentes++
  }

  console.log(`creadas ${creadas} unidades` + (existentes ? `, ${existentes} ya estaban` : ''))
  console.table((await client.query(
    'select count(*)::int as total, sum(case when is_published then 1 else 0 end)::int as publicadas from units',
  )).rows)
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
