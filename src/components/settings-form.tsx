'use client'

import { useActionState, useState } from 'react'
import { updateSettings, type SettingsState } from '@/app/admin/ajustes/actions'
import type { Row } from '@/types/database'

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

export function SettingsForm({ settings }: { settings: Row<'app_settings'> }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateSettings, {})
  const [igtf, setIgtf] = useState(settings.igtf_enabled)

  return (
    <form action={action} className="space-y-8">
      <section>
        <h2 className="text-sm font-medium">Negocio</h2>
        <p className="mt-1 text-sm text-ink/50">
          Aparecen en la web pública, en los correos y en el pie de página.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm text-ink/60">Nombre</span>
            <input
              name="businessName"
              required
              defaultValue={settings.business_name}
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink/60">Correo</span>
            <input
              name="businessEmail"
              type="email"
              defaultValue={settings.business_email ?? ''}
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink/60">Teléfono / WhatsApp</span>
            <input
              name="businessPhone"
              defaultValue={settings.business_phone ?? ''}
              className={field}
            />
          </label>
        </div>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-sm font-medium">Condiciones de cobro</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm text-ink/60">Anticipo</span>
            <div className="relative">
              <input
                name="depositRatio"
                type="number"
                min={1}
                max={100}
                step={1}
                required
                defaultValue={Math.round(settings.default_deposit_ratio * 100)}
                className={`${field} pr-8`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/40">
                %
              </span>
            </div>
            <span className="mt-1 block text-xs text-ink/45">
              Lo que hay que pagar para confirmar.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink/60">Plazo para pagar</span>
            <div className="relative">
              <input
                name="pendingTtlHours"
                type="number"
                min={1}
                max={720}
                required
                defaultValue={settings.pending_ttl_hours}
                className={`${field} pr-12`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/40">
                horas
              </span>
            </div>
            <span className="mt-1 block text-xs text-ink/45">
              Pasado ese plazo las fechas se liberan solas.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink/60">Precios visibles en</span>
            <select
              name="currencyDisplay"
              defaultValue={settings.currency_display}
              className={field}
            >
              <option value="both">Dólares y bolívares</option>
              <option value="usd">Solo dólares</option>
              <option value="ves">Solo bolívares</option>
            </select>
            <span className="mt-1 block text-xs text-ink/45">
              El cobro siempre va a tasa BCV.
            </span>
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-sm text-ink/60">Política de cancelación</span>
          <textarea
            name="cancellationPolicy"
            rows={3}
            defaultValue={settings.cancellation_policy ?? ''}
            className={field}
          />
          <span className="mt-1 block text-xs text-ink/45">
            Se muestra en la ficha del alojamiento y en el checkout.
          </span>
        </label>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-sm font-medium">IGTF</h2>
        <p className="mt-1 text-sm text-ink/50">
          Impuesto sobre pagos en divisas. Solo lo recaudan los negocios designados
          contribuyentes especiales por el SENIAT. Si no lo eres, déjalo apagado.
        </p>

        <label className="mt-4 flex items-center gap-3 text-sm">
          <input
            name="igtfEnabled"
            type="checkbox"
            defaultChecked={settings.igtf_enabled}
            onChange={(e) => setIgtf(e.target.checked)}
            className="h-4 w-4"
          />
          Somos contribuyente especial y recaudamos IGTF
        </label>

        {igtf && (
          <label className="mt-4 block max-w-40">
            <span className="mb-1 block text-sm text-ink/60">Tasa</span>
            <div className="relative">
              <input
                name="igtfRate"
                type="number"
                min={0}
                max={20}
                step={0.1}
                defaultValue={(settings.igtf_rate * 100).toFixed(1)}
                className={`${field} pr-8`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/40">
                %
              </span>
            </div>
          </label>
        )}
        {!igtf && <input type="hidden" name="igtfRate" value={(settings.igtf_rate * 100).toFixed(1)} />}
      </section>

      <div className="flex flex-wrap items-center gap-4 border-t border-ink/10 pt-6">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-ink px-6 py-2.5 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Guardar ajustes'}
        </button>
        {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  )
}
