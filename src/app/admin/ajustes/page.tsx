import { createClient } from '@/lib/supabase/server'
import { SettingsForm } from '@/components/settings-form'
import { PaymentAccounts } from '@/components/payment-accounts'
import { ResendLinkForm } from '@/components/resend-link-form'
import { METHODS } from '@/lib/payment-methods'
import {
  PROVIDERS,
  providerStatusLabel,
  providerStatusTone,
} from '@/lib/payment-providers'
import type { EmailKind } from '@/types/database'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ajustes' }

const EMAIL_LABEL: Record<EmailKind, string> = {
  booking_created: 'Reserva creada',
  payment_received: 'Comprobante recibido',
  payment_approved: 'Pago aprobado',
  payment_rejected: 'Pago rechazado',
  arrival_reminder: 'Recordatorio de llegada',
}

const stamp = new Intl.DateTimeFormat('es-VE', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Caracas',
})

export default async function SettingsPage() {
  const supabase = await createClient()

  const [{ data: settings }, { data: accounts }, { data: emails }] = await Promise.all([
    supabase.from('app_settings').select('*').single(),
    supabase.from('payment_accounts').select('*').order('sort_order'),
    supabase
      .from('email_log')
      .select('id, sent_at, kind, recipient, ok, detail')
      .order('sent_at', { ascending: false })
      .limit(15),
  ])

  if (!settings) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-ink/70">No se pudieron cargar los ajustes.</p>
      </main>
    )
  }

  const failed = (emails ?? []).filter((e) => !e.ok).length

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>

      <div className="mt-8 rounded-2xl border border-ink/10 bg-white p-6">
        <SettingsForm settings={settings} />
      </div>

      <div className="mt-8">
        <PaymentAccounts accounts={accounts ?? []} />
      </div>

      {/* Pasarelas */}
      <section className="mt-10">
        <h2 className="text-base font-semibold">Pasarelas de pago</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          Cobros que se confirman solos, sin verificación manual. El reporte de comprobante
          no desaparece cuando alguna se active: siempre habrá quien pague por Zelle.
        </p>

        <ul className="mt-4 space-y-3">
          {PROVIDERS.map((p) => (
            <li key={p.id} className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium">{p.label}</span>
                <span
                  className={`rounded-full px-3 py-1 text-xs ${providerStatusTone[p.status]}`}
                >
                  {providerStatusLabel[p.status]}
                </span>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-ink/70">{p.note}</p>

              <p className="mt-3 flex flex-wrap gap-1.5">
                {p.methods.map((m) => (
                  <span
                    key={m}
                    className="rounded-full bg-ink/6 px-2 py-0.5 text-[11px] text-ink/70"
                  >
                    {METHODS[m].label}
                  </span>
                ))}
              </p>

              {p.requires.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink/60">
                    Falta
                  </p>
                  <ul className="mt-2 space-y-1">
                    {p.requires.map((r) => (
                      <li key={r} className="flex gap-2 text-sm text-ink/70">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-clay" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Correo */}
      <section className="mt-10">
        <h2 className="text-base font-semibold">Correo</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          El código de la reserva solo vive en la URL y en el correo. Si a un huésped no le
          llegó, reenvíaselo desde aquí.
        </p>

        <div className="mt-4">
          <ResendLinkForm />
        </div>

        <h3 className="mt-8 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-ink/60">
          Últimos envíos
          {failed > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] normal-case tracking-normal text-red-800">
              {failed} fallido{failed > 1 ? 's' : ''}
            </span>
          )}
        </h3>

        {emails && emails.length > 0 ? (
          <ul className="mt-3 divide-y divide-ink/8 rounded-2xl border border-ink/10 bg-white">
            {emails.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className={e.ok ? '' : 'text-red-700'}>{EMAIL_LABEL[e.kind]}</span>
                  <span className="ml-2 text-ink/70">{e.recipient}</span>
                  {!e.ok && e.detail && (
                    <span className="mt-0.5 block text-xs text-red-700">{e.detail}</span>
                  )}
                </span>
                <span className="text-xs text-ink/60">{stamp.format(new Date(e.sent_at))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-ink/20 p-8 text-center text-sm text-ink/60">
            Todavía no se ha enviado ningún correo.
          </p>
        )}
      </section>
    </main>
  )
}
