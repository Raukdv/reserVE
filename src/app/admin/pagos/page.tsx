import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PaymentReviewCard, type ReviewPayment } from '@/components/payment-review-card'
import { PAYMENT_STATUS, PILL_SHAPE, paymentStatus } from '@/lib/payment-status'
import { METHODS } from '@/lib/payment-methods'
import { usd, dateLabel } from '@/lib/format'
import type { PaymentMethod, PaymentStatus } from '@/types/database'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pagos' }

const RECEIPTS_BUCKET = 'receipts'

/**
 * Tamaño de página del histórico.
 *
 * Toda lista lleva tope: cada fila es renderizado en el servidor y el plan Hobby
 * incluye 4 CPU-horas al mes. Ver docs/COSTO-CERO.md, regla 3.8.
 */
const PER_PAGE = 25

const ISO = /^\d{4}-\d{2}-\d{2}$/

const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40'

/**
 * Pagos: la cola de verificación arriba, el histórico debajo.
 *
 * ## Por qué en ese orden y no mezclados
 *
 * La cola vale porque **cuando está vacía, has terminado**. Ese vacío es
 * información, no un hueco que rellenar. Colgando el histórico encima o
 * entremedio, la página dejaría de responder «¿me falta algo?» para responder
 * «¿qué ha pasado?», que es otra pregunta y de otro momento del día.
 *
 * Por eso la cola va primera, sin filtros y sin paginar: no se filtra lo que hay
 * que despachar entero.
 *
 * ## Qué añade el histórico que no estuviera ya
 *
 * Cada pago se ve en la ficha de su reserva, así que esto no es para buscar un
 * pago concreto. Es para la pregunta que no se podía hacer: **qué dinero se
 * movió esta semana y por qué canal**, sin ir reserva por reserva.
 *
 * Lo que no lleva es un resumen de totales. Eso es Ingresos, y tenerlo en dos
 * sitios es garantizar que un día digan cosas distintas.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (k: string) => {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
  }

  // Lo que llega por la URL se valida contra las tablas antes de tocar la
  // consulta: no puede ser cualquier cosa.
  const estadoRaw = one('estado')
  const estado =
    estadoRaw && estadoRaw in PAYMENT_STATUS && estadoRaw !== 'verifying'
      ? (estadoRaw as PaymentStatus)
      : undefined

  const metodoRaw = one('metodo')
  const metodo = metodoRaw && metodoRaw in METHODS ? (metodoRaw as PaymentMethod) : undefined

  const desde = ISO.test(one('desde') ?? '') ? one('desde')! : undefined
  const hasta = ISO.test(one('hasta') ?? '') ? one('hasta')! : undefined
  const page = Math.max(1, Number(one('pagina')) || 1)

  const supabase = await createClient()

  const cola = supabase
    .from('payments')
    .select(`
      id, method, currency, amount, amount_usd, igtf_usd, origin, reference, paid_at,
      payer_name, payer_document, receipt_path, created_at,
      bookings (
        code, guest_name, guest_email, check_in, check_out,
        total_usd, deposit_ratio, status,
        units ( name )
      )
    `)
    .eq('status', 'verifying')
    .order('created_at', { ascending: true })

  /*
    El histórico excluye lo que está en la cola.

    Un pago por verificar es un movimiento como cualquier otro, y un libro mayor
    lo incluiría. Pero aquí saldría dos veces en la misma pantalla —tarjeta
    arriba, fila abajo— y ver el mismo dinero repetido invita a contarlo dos
    veces. Cada sección posee un conjunto: la cola lo que falta por despachar,
    el histórico lo ya despachado.

    Por eso el filtro de estado tampoco ofrece «por verificar»: no habría nada
    que enseñar.
  */
  let historico = supabase
    .from('payments')
    .select(
      `id, kind, method, status, currency, amount, amount_usd, paid_at, created_at,
       reference, payer_name,
       bookings ( code, guest_name )`,
      { count: 'exact' },
    )
    .neq('status', 'verifying')

  if (estado) historico = historico.eq('status', estado)
  if (metodo) historico = historico.eq('method', metodo)
  if (desde) historico = historico.gte('paid_at', `${desde}T00:00:00Z`)
  if (hasta) historico = historico.lt('paid_at', `${hasta}T23:59:59Z`)

  const from = (page - 1) * PER_PAGE

  const [{ data: rows }, { data: movimientos, count }] = await Promise.all([
    cola,
    historico
      // Por fecha de pago, que es cuando se movió el dinero. Los que no la
      // tengan van al final en vez de encabezar la lista.
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + PER_PAGE - 1),
  ])

  // Las capturas viven en un bucket privado: se firman en el servidor y la URL
  // caduca. Nunca se expone el bucket entero.
  const withPath = (rows ?? []).filter((r) => r.receipt_path)
  const signed = new Map<string, string>()

  if (withPath.length > 0) {
    const admin = createAdminClient()
    const { data } = await admin.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUrls(withPath.map((r) => r.receipt_path!), 60 * 10)

    for (const item of data ?? []) {
      if (item.signedUrl && item.path) signed.set(item.path, item.signedUrl)
    }
  }

  const payments: ReviewPayment[] = (rows ?? []).map((r) => {
    const b = Array.isArray(r.bookings) ? r.bookings[0] : r.bookings
    const unit = b ? (Array.isArray(b.units) ? b.units[0] : b.units) : null

    return {
      id: r.id,
      method: r.method,
      currency: r.currency,
      amount: Number(r.amount),
      amount_usd: Number(r.amount_usd),
      igtf_usd: Number(r.igtf_usd),
      origin: r.origin,
      reference: r.reference,
      paid_at: r.paid_at,
      payer_name: r.payer_name,
      payer_document: r.payer_document,
      receiptUrl: r.receipt_path ? signed.get(r.receipt_path) ?? null : null,
      createdAt: r.created_at,
      booking: b
        ? {
            code: b.code,
            guestName: b.guest_name,
            guestEmail: b.guest_email,
            unitName: unit?.name ?? '—',
            checkIn: b.check_in,
            checkOut: b.check_out,
            totalUsd: Number(b.total_usd),
            depositRatio: Number(b.deposit_ratio),
            status: b.status,
          }
        : null,
    }
  })

  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  const filtrado = Boolean(estado || metodo || desde || hasta)

  // Conserva los filtros al cambiar de página.
  const pageHref = (n: number) => {
    const params = new URLSearchParams()
    if (estado) params.set('estado', estado)
    if (metodo) params.set('metodo', metodo)
    if (desde) params.set('desde', desde)
    if (hasta) params.set('hasta', hasta)
    if (n > 1) params.set('pagina', String(n))
    const s = params.toString()
    return s ? `/admin/pagos?${s}#movimientos` : '/admin/pagos#movimientos'
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Pagos</h1>

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-lg font-semibold tracking-tight">Por verificar</h2>
          {payments.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
              {payments.length}
            </span>
          )}
        </div>
        <p className="mt-1 text-descripcion text-ink/70">
          Contrasta cada comprobante contra tu cuenta antes de aprobar. Aprobar un pago
          que cubra el anticipo confirma la reserva automáticamente.
        </p>

        {payments.length > 0 ? (
          <div className="mt-5 space-y-5">
            {payments.map((p) => (
              <PaymentReviewCard key={p.id} payment={p} />
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed border-ink/20 p-12 text-center text-sm text-ink/70">
            No hay pagos pendientes de verificación.
          </p>
        )}
      </section>

      <section id="movimientos" className="mt-14 border-t border-ink/10 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Movimientos</h2>
            <p className="mt-1 text-descripcion text-ink/70">
              {total} {total === 1 ? 'movimiento' : 'movimientos'}
              {filtrado ? ' con estos filtros' : ' registrados'}
            </p>
          </div>
        </div>

        {/*
          Formulario GET sin JavaScript: los filtros viven en la URL, así que se
          pueden compartir y marcar, y no hace falta un componente cliente.
        */}
        <form
          method="get"
          className="mt-5 grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">Estado</span>
            <select name="estado" defaultValue={estado ?? ''} className={field}>
              <option value="">Todos</option>
              {/* «Por verificar» no está: eso vive en la cola de arriba. */}
              {Object.entries(PAYMENT_STATUS)
                .filter(([value]) => value !== 'verifying')
                .map(([value, { label }]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">Canal</span>
            <select name="metodo" defaultValue={metodo ?? ''} className={field}>
              <option value="">Todos</option>
              {Object.entries(METHODS).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">Desde</span>
            <input name="desde" type="date" defaultValue={desde ?? ''} className={field} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">Hasta</span>
            <input name="hasta" type="date" defaultValue={hasta ?? ''} className={field} />
          </label>

          <div className="flex items-end gap-3">
            <button className="rounded-lg bg-ink px-5 py-2 text-sm text-sand transition hover:bg-ink/85">
              Filtrar
            </button>
            {filtrado && (
              <Link href="/admin/pagos#movimientos" className="pb-2 text-sm text-ink/70 hover:underline">
                Limpiar
              </Link>
            )}
          </div>
        </form>

        {movimientos && movimientos.length > 0 ? (
          <>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-ink/10 bg-white">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
                    <th className="px-5 py-3 font-normal">Fecha</th>
                    <th className="px-5 py-3 font-normal">Reserva</th>
                    <th className="px-5 py-3 font-normal">Canal</th>
                    <th className="px-5 py-3 text-right font-normal">Importe</th>
                    <th className="px-5 py-3 text-right font-normal">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  {movimientos.map((m) => {
                    const b = Array.isArray(m.bookings) ? m.bookings[0] : m.bookings
                    const pill = paymentStatus(m.status)
                    // Una devolución es dinero que sale. Sin el signo, en una
                    // lista mezclada con los cobros se lee como uno más.
                    const sale = m.kind === 'refund'

                    return (
                      <tr key={m.id} className="relative hover:bg-sand/60">
                        <td className="px-5 py-3 text-ink/70">
                          {/*
                            La fila entera enlaza a la reserva. El `relative` va
                            en el <tr>: anclado al <td>, `inset-0` cubriría solo
                            esa celda.
                          */}
                          {b && (
                            <Link
                              href={`/admin/reservas/${b.code}`}
                              className="absolute inset-0"
                              aria-label={`Ver reserva ${b.code}`}
                            />
                          )}
                          {m.paid_at ? dateLabel(m.paid_at.slice(0, 10)) : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-xs">{b?.code ?? '—'}</span>
                          <span className="mt-0.5 block text-xs text-ink/60">
                            {b?.guest_name ?? m.payer_name ?? ''}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-ink/70">
                          {METHODS[m.method as PaymentMethod]?.label ?? m.method}
                          {m.reference && (
                            <span className="mt-0.5 block font-mono text-xs text-ink/60">
                              {m.reference}
                            </span>
                          )}
                        </td>
                        <td className={`px-5 py-3 text-right ${sale ? 'text-ink/70' : ''}`}>
                          {sale && '−'}
                          {usd(Number(m.amount_usd))}
                          {m.currency !== 'USD' && (
                            <span className="mt-0.5 block text-xs text-ink/60">
                              {new Intl.NumberFormat('es-VE', {
                                style: 'currency',
                                currency: m.currency,
                              }).format(Number(m.amount))}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`${PILL_SHAPE} ${pill.tone}`}>{pill.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="mt-5 flex items-center justify-between text-sm">
                <span className="text-ink/70">
                  Página {page} de {pages}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={pageHref(page - 1)}
                      className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 hover:border-ink/35"
                    >
                      Anterior
                    </Link>
                  )}
                  {page < pages && (
                    <Link
                      href={pageHref(page + 1)}
                      className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 hover:border-ink/35"
                    >
                      Siguiente
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed border-ink/20 p-8 text-center text-sm text-ink/70">
            {filtrado ? 'Ningún movimiento con estos filtros.' : 'Sin movimientos todavía.'}
          </p>
        )}
      </section>
    </main>
  )
}
