'use client'

import { useActionState, useState } from 'react'
import { saveAccount, deleteAccount, type SettingsState } from '@/app/admin/ajustes/actions'
import { METHODS, GUEST_METHODS } from '@/lib/payment-methods'
import { DocumentInput } from '@/components/document-input'
import type { PaymentMethod, Row } from '@/types/database'

type Account = Row<'payment_accounts'>

const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40'

/**
 * Cuentas a las que paga el huésped.
 *
 * Sin al menos una activa, la página de la reserva no muestra a dónde pagar y el
 * flujo se corta: el huésped no puede completar el primer paso.
 */
export function PaymentAccounts({ accounts }: { accounts: Account[] }) {
  const [adding, setAdding] = useState(false)
  const active = accounts.filter((a) => a.is_active).length

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Cuentas de cobro</h2>
          <p className="mt-1 text-descripcion text-ink/70">
            Es lo que el huésped ve cuando va a pagar. Cada una lleva el dato exacto al que
            debe enviar el dinero.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-ink/15 px-4 py-2 text-sm transition hover:border-ink/40"
        >
          {adding ? 'Cancelar' : 'Añadir cuenta'}
        </button>
      </div>

      {active === 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No hay ninguna cuenta activa. El huésped no verá a dónde pagar y no podrá
          completar su reserva.
        </p>
      )}

      {adding && (
        <div className="mt-4 rounded-2xl border border-ink/15 bg-white p-5">
          <p className="mb-4 text-sm font-medium">Nueva cuenta</p>
          <AccountForm onDone={() => setAdding(false)} />
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))}
      </ul>

      {accounts.length === 0 && !adding && (
        <p className="mt-4 rounded-2xl border border-dashed border-ink/20 p-10 text-center text-sm text-ink/70">
          Todavía no has cargado ninguna cuenta.
        </p>
      )}
    </section>
  )
}

function AccountRow({ account }: { account: Account }) {
  const [editing, setEditing] = useState(false)
  const [removeState, remove, removing] = useActionState<SettingsState, FormData>(
    deleteAccount,
    {},
  )

  const spec = METHODS[account.method]

  return (
    <li className="rounded-2xl border border-ink/10 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{account.label}</span>
            <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[11px] text-ink/70">
              {spec.label} · {spec.currency}
            </span>
            {!account.is_active && (
              <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[11px] text-ink/60">
                Oculta
              </span>
            )}
          </p>
          <p className="mt-1 font-mono text-sm text-ink/70">{account.identifier}</p>
          {(account.holder || account.bank) && (
            <p className="mt-0.5 text-xs text-ink/60">
              {[account.holder, account.document, account.bank].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm">
          {removeState.error && (
            <span className="text-xs text-red-700">{removeState.error}</span>
          )}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-ink/70 underline hover:text-ink"
          >
            {editing ? 'Cerrar' : 'Editar'}
          </button>
          <form action={remove}>
            <input type="hidden" name="id" value={account.id} />
            <button
              disabled={removing}
              className="text-ink/60 underline hover:text-red-700 disabled:opacity-50"
            >
              {removing ? 'Eliminando…' : 'Eliminar'}
            </button>
          </form>
        </div>
      </div>

      {editing && (
        <div className="border-t border-ink/10 p-5">
          <AccountForm account={account} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  )
}

function AccountForm({ account, onDone }: { account?: Account; onDone: () => void }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveAccount, {})
  const [method, setMethod] = useState<PaymentMethod>(account?.method ?? 'pago_movil')

  const spec = METHODS[method]

  // Al guardar con éxito se cierra el editor, para que la fila muestre el dato ya
  // actualizado en vez de dejar el formulario abierto con lo mismo.
  if (state.ok) {
    queueMicrotask(onDone)
  }

  return (
    <form action={action} className="space-y-4">
      {account && <input type="hidden" name="id" value={account.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Canal</span>
          <select
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className={field}
          >
            {GUEST_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHODS[m].label} · {METHODS[m].currency}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Nombre visible</span>
          <input
            name="label"
            required
            defaultValue={account?.label}
            placeholder="Pago Móvil Banesco"
            className={field}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink">
            Dato al que se paga — {spec.originLabel.toLowerCase()}
          </span>
          <input
            name="identifier"
            required
            defaultValue={account?.identifier}
            placeholder={spec.originPlaceholder}
            className={`${field} font-mono`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Titular</span>
          <input name="holder" defaultValue={account?.holder ?? ''} className={field} />
        </label>

        {/* Aquí se identifica al negocio, así que por defecto RIF jurídico. */}
        <DocumentInput
          name="document"
          label="Cédula o RIF"
          defaultValue={account?.document}
          defaultType="J"
        />

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Banco</span>
          <input
            name="bank"
            defaultValue={account?.bank ?? ''}
            placeholder="Banesco (0134)"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Orden</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={99}
            defaultValue={account?.sort_order ?? 0}
            className={field}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink">Instrucciones</span>
          <input
            name="instructions"
            defaultValue={account?.instructions ?? ''}
            placeholder="Solo red TRC20. Envíos por otra red se pierden."
            className={field}
          />
        </label>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          name="isActive"
          type="checkbox"
          defaultChecked={account?.is_active ?? true}
          className="h-4 w-4"
        />
        Visible para el huésped
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-5 py-2 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : account ? 'Guardar cambios' : 'Añadir cuenta'}
        </button>
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  )
}
