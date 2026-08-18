'use client'

import { useActionState, useState } from 'react'
import { updateSettings, type SettingsState } from '@/app/admin/ajustes/actions'
import {
  POLICY_PRESETS,
  POLICY_TITLE,
  genericPolicy,
  matchPreset,
  parseTiers,
  tierTitle,
  type CancellationTier,
} from '@/lib/cancellation'
import type { Row } from '@/types/database'

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

/**
 * Editor de la escalera de reembolso, escalón a escalón.
 *
 * Se maneja en **días** porque es como se piensa una política de cancelación;
 * en la base van horas, que es lo que permite plazos más finos si algún día
 * hacen falta.
 *
 * Controlado desde fuera: quien manda es la política elegida, y esto solo
 * aparece cuando esa política es propia.
 */
function CancellationTiers({
  tiers,
  setTiers,
  checkInTime,
}: {
  tiers: CancellationTier[]
  setTiers: (next: CancellationTier[]) => void
  checkInTime: string
}) {
  const update = (i: number, next: CancellationTier) =>
    setTiers(tiers.map((t, j) => (j === i ? next : t)))

  const days = (t: CancellationTier) => Math.round(t.hours_before / 24)

  return (
    <div className="mt-4">
      <ul className="space-y-2">
        {tiers.map((tier, i) => (
          <li key={i} className="rounded-xl border border-ink/10 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">Días antes</span>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={days(tier)}
                  onChange={(e) =>
                    update(i, { ...tier, hours_before: Number(e.target.value) * 24 })
                  }
                  className="w-24 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">Se devuelve</span>
                <select
                  value={tier.kind}
                  onChange={(e) =>
                    update(
                      i,
                      e.target.value === 'nights'
                        ? { hours_before: tier.hours_before, kind: 'nights', forfeit_nights: 1 }
                        : { hours_before: tier.hours_before, kind: 'percent', refund_percent: 100 },
                    )
                  }
                  className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
                >
                  <option value="percent">Un porcentaje</option>
                  <option value="nights">Se cobran las primeras noches</option>
                </select>
              </label>

              {tier.kind === 'percent' ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink">Porcentaje</span>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={tier.refund_percent}
                      onChange={(e) =>
                        update(i, { ...tier, refund_percent: Number(e.target.value) })
                      }
                      className="w-24 rounded-lg border border-ink/15 bg-white px-3 py-2 pr-7 text-sm"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/60">
                      %
                    </span>
                  </div>
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink">Noches que cobras igual</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={tier.forfeit_nights}
                    onChange={(e) =>
                      update(i, { ...tier, forfeit_nights: Number(e.target.value) })
                    }
                    className="w-24 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
                  />
                </label>
              )}

              {tiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                  className="ml-auto pb-2 text-xs text-ink/60 underline hover:text-red-700"
                >
                  Quitar
                </button>
              )}
            </div>

            <p className="mt-2 text-xs text-ink/70">
              Cancelando hasta {days(tier)} día{days(tier) === 1 ? '' : 's'} antes de las{' '}
              {checkInTime}: {tierTitle(tier).toLowerCase()}.
              {tier.kind === 'nights'
                ? ` Retienes ${tier.forfeit_nights} noche${tier.forfeit_nights === 1 ? '' : 's'} a su precio real —no un promedio— y devuelves el resto.`
                : tier.refund_percent >= 100
                  ? ' Vuelve todo, cargos incluidos.'
                  : ''}
              {/*
                Qué pasa con los cargos no lo decide el tramo sino la casilla
                «reembolsable» de cada uno, así que aquí no se puede afirmar.
              */}
              {!(tier.kind === 'percent' && tier.refund_percent >= 100) && (
                <>
                  {' '}
                  De los{' '}
                  <a href="/admin/cargos" className="underline">
                    cargos
                  </a>{' '}
                  solo vuelven los marcados reembolsables, en la misma proporción.
                </>
              )}
            </p>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() =>
          setTiers([...tiers, { hours_before: 72, kind: 'nights', forfeit_nights: 1 }])
        }
        className="mt-3 rounded-lg border border-ink/15 px-4 py-1.5 text-sm transition hover:border-ink/40"
      >
        Añadir tramo
      </button>

      <p className="mt-3 text-xs text-ink/60">
        Lo que no cubra ningún tramo no se reembolsa. Y nunca se devuelve más de lo que
        el huésped llegó a pagar.
      </p>
    </div>
  )
}

/**
 * Política de cancelación del negocio. Una, no varias.
 *
 * Se elige por nombre y la escalera aparece debajo como consecuencia, que es
 * como la presentan Airbnb y Booking. El editor tramo a tramo sigue existiendo
 * detrás de «Personalizada», pero deja de ser lo primero que se ve: montar una
 * política desde cero es el caso raro, y una lista de fichas que se añaden y se
 * quitan daba a entender que se estaban apilando varias políticas a la vez.
 */
function CancellationPolicy({
  value,
  checkInTime,
}: {
  value: CancellationTier[]
  checkInTime: string
}) {
  const preset = matchPreset(value)

  // Sin tramos guardados se arranca en «Moderada», que es el punto medio.
  const [choice, setChoice] = useState(
    value.length === 0 ? 'moderada' : (preset?.id ?? 'custom'),
  )
  const [custom, setCustom] = useState<CancellationTier[]>(
    value.length > 0 ? value : POLICY_PRESETS[1].tiers,
  )

  const tiers =
    choice === 'custom'
      ? custom
      : (POLICY_PRESETS.find((p) => p.id === choice)?.tiers ?? custom)

  const options = [
    ...POLICY_PRESETS.map((p) => ({ id: p.id, label: p.label, hint: p.hint })),
    {
      id: 'custom',
      label: 'Personalizada',
      hint: 'Tus propios plazos. Admite cobrar las primeras noches en vez de un porcentaje.',
    },
  ]

  return (
    <div className="mt-4">
      <input type="hidden" name="cancellationTiers" value={JSON.stringify(tiers)} />

      <ul className="space-y-2">
        {options.map((option) => {
          const on = choice === option.id
          return (
            <li key={option.id}>
              <label
                className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${
                  on ? 'border-ink/40 bg-ink/5' : 'border-ink/10 hover:border-ink/25'
                }`}
              >
                <input
                  type="radio"
                  name="policyPreset"
                  checked={on}
                  onChange={() => setChoice(option.id)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-ink/60">{option.hint}</span>

                  {/* La escalera de cada opción, para poder compararlas de un vistazo. */}
                  {option.id !== 'custom' && (
                    <span className="mt-2 block space-y-0.5">
                      {POLICY_PRESETS.find((p) => p.id === option.id)!.tiers.map((t) => (
                        <span key={t.hours_before} className="block text-xs text-ink/70">
                          Hasta {Math.round(t.hours_before / 24)} día
                          {Math.round(t.hours_before / 24) === 1 ? '' : 's'} antes:{' '}
                          {tierTitle(t).toLowerCase()}
                        </span>
                      ))}
                      <span className="block text-xs text-ink/70">
                        Después: sin reembolso
                      </span>
                    </span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {choice === 'custom' && (
        <CancellationTiers tiers={custom} setTiers={setCustom} checkInTime={checkInTime} />
      )}

      {/*
        Vista previa literal de lo que sale en /legal/cancelacion.
        Está aquí, y no en Contenido, porque es el único sitio donde el operador
        puede leer lo que la web ya promete antes de escribir el texto de apoyo
        que va debajo. Sin esto, las dos cosas se redactaban a ciegas.
      */}
      <div className="mt-5 rounded-xl bg-sand p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink/60">
          Así se publica
        </p>
        <ul className="mt-2 space-y-1.5">
          {genericPolicy(tiers).map((line) => (
            <li key={line} className="flex gap-2 text-xs leading-relaxed text-ink/70">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-clay" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink/60">
          Los plazos se miden desde la hora de entrada, las {checkInTime}.
        </p>
      </div>
    </div>
  )
}

export function SettingsForm({ settings }: { settings: Row<'app_settings'> }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateSettings, {})
  const [igtf, setIgtf] = useState(settings.igtf_enabled)

  return (
    <form action={action} className="space-y-8">
      <section>
        <h2 className="text-base font-semibold">Negocio</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          Aparecen en la web pública, en los correos y en el pie de página. Son la
          identidad del negocio: las unidades —habitaciones, casas, apartamentos— se
          configuran aparte.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-ink">Nombre</span>
            <input
              name="businessName"
              required
              defaultValue={settings.business_name}
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Correo</span>
            <input
              name="businessEmail"
              type="email"
              defaultValue={settings.business_email ?? ''}
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Teléfono / WhatsApp</span>
            <input
              name="businessPhone"
              defaultValue={settings.business_phone ?? ''}
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Ciudad</span>
            <input
              name="businessCity"
              defaultValue={settings.business_city ?? ''}
              placeholder="Choroní, Aragua"
              className={field}
            />
            <span className="mt-1 block text-xs text-ink/60">
              Sale en la portada, encima del titular.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Dirección</span>
            <input
              name="businessAddress"
              defaultValue={settings.business_address ?? ''}
              placeholder="Calle La Playa, sector Puerto Colombia"
              className={field}
            />
            <span className="mt-1 block text-xs text-ink/60">
              La sección «cómo llegar» puede poner otra; esta es el respaldo.
            </span>
          </label>
        </div>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-base font-semibold">Condiciones de cobro</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          Cuánto se pide por adelantado y cuánto aguanta una reserva sin pagar antes de
          liberar las fechas.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Anticipo</span>
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
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/60">
                %
              </span>
            </div>
            <span className="mt-1 block text-xs text-ink/60">
              Lo que hay que pagar para confirmar.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Plazo para pagar</span>
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
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/60">
                horas
              </span>
            </div>
            <span className="mt-1 block text-xs text-ink/60">
              Pasado ese plazo las fechas se liberan solas.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Precios visibles en</span>
            <select
              name="currencyDisplay"
              defaultValue={settings.currency_display}
              className={field}
            >
              <option value="both">Dólares y bolívares</option>
              <option value="usd">Solo dólares</option>
              <option value="ves">Solo bolívares</option>
            </select>
            <span className="mt-1 block text-xs text-ink/60">
              El cobro siempre va a tasa BCV.
            </span>
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Hora de entrada</span>
            <input
              name="checkInTime"
              type="time"
              required
              defaultValue={settings.check_in_time.slice(0, 5)}
              className={field}
            />
            <span className="mt-1 block text-xs text-ink/60">
              Desde aquí se miden los plazos de cancelación.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Hora de salida</span>
            <input
              name="checkOutTime"
              type="time"
              required
              defaultValue={settings.check_out_time.slice(0, 5)}
              className={field}
            />
          </label>
        </div>
      </section>

      {/*
        La política de cancelación se edita entera aquí: la regla que mueve
        dinero y el texto que la acompaña en la web. Estuvo partida entre Ajustes
        y Contenido, y nada garantizaba que las dos mitades dijeran lo mismo.
      */}
      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-base font-semibold">Políticas</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          La escalera de reembolso y el texto que la acompaña en{' '}
          <a href="/legal/cancelacion" target="_blank" className="underline">
            la página pública
          </a>
          . Los tramos mandan: son lo que calcula el servidor cuando alguien cancela, y
          se publican siempre.
        </p>

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-ink/60">
          Política de cancelación
        </h3>
        <p className="mt-1 text-sm text-ink/70">
          Una sola para todo el negocio. Dice hasta cuándo se puede cancelar y qué parte
          se devuelve; el huésped ve las fechas exactas de su reserva, no una regla que
          tenga que traducir.
        </p>

        <CancellationPolicy
          value={parseTiers(settings.cancellation_tiers)}
          checkInTime={settings.check_in_time.slice(0, 5)}
        />

        <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-ink/60">
          Página pública
        </h3>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium text-ink">
            Título <span className="text-ink/60">(opcional)</span>
          </span>
          <input
            name="cancellationTitle"
            defaultValue={settings.cancellation_title ?? ''}
            placeholder={POLICY_TITLE}
            className={field}
          />
        </label>

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium text-ink">
            Texto de apoyo <span className="text-ink/60">(opcional)</span>
          </span>
          <textarea
            name="cancellationPolicy"
            rows={4}
            defaultValue={settings.cancellation_policy ?? ''}
            placeholder={
              'Cómo y en cuántos días se devuelve el dinero.\n\n' +
              'Qué pasa si el huésped no se presenta.\n\n' +
              'Si admites cambios de fecha en lugar de cancelar.'
            }
            className={field}
          />
          <span className="mt-1 block text-xs text-ink/60">
            Va debajo de la escalera, no en su lugar. Lo que escribas aquí no cambia
            ningún cálculo: si contradice un tramo, el huésped lee una cosa y cobra
            otra.
          </span>
        </label>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-base font-semibold">IGTF</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          Impuesto a las Grandes Transacciones Financieras. Lo causa{' '}
          <strong className="font-medium text-ink">el medio de pago</strong>, no la
          estadía: la misma reserva lo genera o no según cómo se cobre.
        </p>

        <ul className="mt-3 space-y-1 text-sm text-ink/70">
          <li className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-clay" />
            Zelle, PayPal, Binance, USDT y efectivo en divisas: se añade la tasa.
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-clay" />
            Pago Móvil, transferencia nacional y C2P: nada. Los bolívares están al 0 %
            desde el Decreto 4.972 de julio de 2024.
          </li>
        </ul>

        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            name="igtfEnabled"
            type="checkbox"
            defaultChecked={settings.igtf_enabled}
            onChange={(e) => setIgtf(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Somos contribuyente especial y recaudamos IGTF
            <span className="mt-0.5 block text-xs text-ink/60">
              Solo puede cobrarlo quien esté calificado como sujeto pasivo especial por
              el SENIAT. Si no lo eres, cobrarlo es improcedente — déjalo apagado.
            </span>
          </span>
        </label>

        {igtf && (
          <label className="mt-4 block max-w-40">
            <span className="mb-1 block text-sm font-medium text-ink">Tasa</span>
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
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/60">
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
