import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PaymentReviewCard, type ReviewPayment } from '@/components/payment-review-card'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pagos' }

const RECEIPTS_BUCKET = 'receipts'

export default async function PaymentsPage() {
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('payments')
    .select(`
      id, method, currency, amount, amount_usd, origin, reference, paid_at,
      payer_name, payer_document, receipt_path, created_at,
      bookings (
        code, guest_name, guest_email, check_in, check_out,
        total_usd, deposit_ratio, status,
        units ( name )
      )
    `)
    .eq('status', 'verifying')
    .order('created_at', { ascending: true })

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

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Pagos por verificar</h1>
      <p className="mt-1 text-sm text-ink/55">
        Contrasta cada comprobante contra tu cuenta antes de aprobar. Aprobar un pago que
        cubra el anticipo confirma la reserva automáticamente.
      </p>

      {payments.length > 0 ? (
        <div className="mt-8 space-y-5">
          {payments.map((p) => (
            <PaymentReviewCard key={p.id} payment={p} />
          ))}
        </div>
      ) : (
        <p className="mt-8 rounded-2xl border border-dashed border-ink/20 p-12 text-center text-sm text-ink/50">
          No hay pagos pendientes de verificación.
        </p>
      )}
    </main>
  )
}
