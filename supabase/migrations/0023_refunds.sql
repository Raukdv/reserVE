-- Registrar las devoluciones.
--
-- `payment_kind = 'refund'` y `payment_status = 'refunded'` existían en los enum
-- desde el inicio y nada los escribía: se cancelaba una reserva, se calculaba
-- cuánto tocaba devolver, y el dinero salía de la cuenta sin dejar rastro en la
-- reserva. No había forma de responder «¿se le devolvió?» sin mirar el banco.
--
-- ## Dos hechos distintos, dos registros
--
-- Cancelar genera una **obligación**; devolver el dinero es un **acto posterior**
-- que puede tardar días, hacerse por otro canal o quedarse a medias. Anotar la
-- devolución en el momento de cancelar sería afirmar que el dinero se movió
-- cuando todavía no. Así que:
--
--   staff_cancel_booking()  → congela lo que se debe en refund_due_usd
--   staff_record_refund()   → anota cada devolución realmente hecha
--
-- ## Por qué `status = 'refunded'` y no `'approved'`
--
-- Ocho funciones calculan lo pagado con `sum(amount_usd) where status =
-- 'approved'`. Una devolución guardada como aprobada inflaría ese total y la
-- reserva parecería más pagada cuanto más dinero se hubiera devuelto.
--
-- Usar `'refunded'` las deja fuera de todas esas sumas sin tocar ninguna, y a la
-- vez dentro de la lista de movimientos de `get_booking()`, que no filtra por
-- estado — que es exactamente donde tiene que verse.
--
-- El importe se guarda **positivo**, como cualquier otro pago: el sentido lo
-- lleva `kind`, no el signo. `payments.amount` tiene un check `> 0`.

alter table bookings
  add column if not exists refund_due_usd numeric(12, 2);

comment on column bookings.refund_due_usd is
  'Lo que la política obligaba a devolver en el momento de cancelar. Congelado '
  'ahí para que recalcularlo después, con otros tramos o precios, no cambie una '
  'deuda ya contraída. Null si la reserva nunca se canceló.';

-- ---------------------------------------------------------------------------
-- Cancelar deja anotado lo que se debe
-- ---------------------------------------------------------------------------

create or replace function staff_cancel_booking(p_code text, p_reason text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_quote   jsonb;
  v_due     numeric(12, 2);
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_booking.status in ('cancelled', 'expired', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'booking_closed');
  end if;

  -- Se cotiza antes de cambiar el estado: el tramo vigente depende de la fecha
  -- de llegada y del momento actual, no del estado, pero cotizar después dejaría
  -- el cálculo a merced de cualquier futuro guard sobre reservas cerradas.
  v_quote := cancellation_quote(v_booking.code);
  v_due   := round(coalesce((v_quote->>'refund_usd')::numeric, 0), 2);

  update bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = nullif(trim(p_reason), ''),
         refund_due_usd = v_due,
         expires_at = null,
         updated_at = now()
   where id = v_booking.id;

  update unit_holds set is_active = false where id = v_booking.hold_id;

  return jsonb_build_object('ok', true, 'refund_due_usd', v_due);
end;
$$;

-- ---------------------------------------------------------------------------
-- Anotar una devolución hecha
-- ---------------------------------------------------------------------------

create or replace function staff_record_refund(
  p_code      text,
  p_method    payment_method,
  p_currency  text,
  p_amount    numeric,
  p_reference text default null,
  p_paid_at   timestamptz default null,
  p_notes     text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking   bookings%rowtype;
  v_usd       numeric(12, 2);
  v_paid      numeric(12, 2);
  v_refunded  numeric(12, 2);
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if p_currency not in ('USD', 'VES') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_paid_at is not null and p_paid_at > now() + interval '1 day' then
    return jsonb_build_object('ok', false, 'error', 'future_date');
  end if;

  -- Misma tasa congelada con la que se cobró. Devolver a la tasa de hoy
  -- cambiaría el importe en dólares de una operación ya cerrada.
  v_usd := case
    when p_currency = 'USD' then round(p_amount, 2)
    else round(p_amount / v_booking.rate_snapshot, 2)
  end;

  if v_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  select coalesce(sum(amount_usd), 0) into v_refunded
  from payments
  where booking_id = v_booking.id and kind = 'refund' and status = 'refunded';

  -- La invariante dura: no se puede devolver más de lo que llegó a entrar.
  -- Lo que la política obligue es otra cosa; el tope lo pone la caja.
  if v_refunded + v_usd > v_paid + 0.01 then
    return jsonb_build_object(
      'ok', false, 'error', 'exceeds_paid',
      'paid_usd', v_paid, 'refunded_usd', v_refunded,
      'available_usd', greatest(v_paid - v_refunded, 0)
    );
  end if;

  insert into payments (
    booking_id, kind, method, status, currency, amount, amount_usd, rate_used,
    reference, paid_at, admin_notes, reviewed_by, reviewed_at
  ) values (
    v_booking.id, 'refund'::payment_kind, p_method, 'refunded'::payment_status,
    p_currency, p_amount, v_usd,
    case when p_currency = 'VES' then v_booking.rate_snapshot else null end,
    nullif(trim(p_reference), ''), coalesce(p_paid_at, now()),
    nullif(trim(p_notes), ''), auth.uid(), now()
  );

  v_refunded := v_refunded + v_usd;

  return jsonb_build_object(
    'ok',              true,
    'amount_usd',      v_usd,
    'refunded_usd',    v_refunded,
    'due_usd',         v_booking.refund_due_usd,
    -- Lo que falta según la política. Null si la reserva no se canceló: una
    -- devolución puede hacerse por acuerdo sin que haya obligación calculada.
    'pending_usd',     case
                         when v_booking.refund_due_usd is null then null
                         else greatest(round(v_booking.refund_due_usd - v_refunded, 2), 0)
                       end,
    'available_usd',   greatest(round(v_paid - v_refunded, 2), 0)
  );
end;
$$;

revoke all on function staff_record_refund from public, anon;
grant execute on function staff_record_refund to authenticated;
