-- Acciones del operador sobre una reserva.
--
-- Hay dos caminos y conviene no confundirlos:
--
--   1. **Registrar un cobro.** El dinero entró por fuera de la app —efectivo al
--      llegar, transferencia que el operador ya vio en su cuenta, reserva
--      cerrada por teléfono— y se anota como pago aprobado. La contabilidad
--      queda correcta y la reserva se confirma sola si cubre el anticipo.
--
--   2. **Confirmar sin cobro.** Cortesía, acuerdo especial, o pago que llegará
--      después. Rompe la invariante de «confirmada implica anticipo cubierto»,
--      así que queda registrado quién lo hizo y por qué.
--
-- El primero debe ser el camino normal. El segundo existe porque la realidad no
-- siempre cabe en el modelo, pero deja rastro.

alter table bookings
  add column if not exists manual_confirmation_by uuid references profiles(id),
  add column if not exists manual_confirmation_reason text,
  add column if not exists manual_confirmation_at timestamptz;

comment on column bookings.manual_confirmation_reason is
  'Por qué se confirmó sin cubrir el anticipo. Null en las confirmadas por pago.';

-- ---------------------------------------------------------------------------
-- Registrar un cobro recibido fuera de la app
-- ---------------------------------------------------------------------------

create or replace function staff_record_payment(
  p_code      text,
  p_method    payment_method,
  p_currency  text,
  p_amount    numeric,
  p_reference text default null,
  p_notes     text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_staff      uuid := auth.uid();
  v_booking    bookings%rowtype;
  v_amount_usd numeric(12, 2);
  v_paid       numeric(12, 2);
  v_kind       payment_kind;
  v_settled    jsonb;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_booking.status in ('cancelled', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'booking_closed');
  end if;

  if p_currency not in ('USD', 'VES') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  v_amount_usd := case
    when p_currency = 'USD' then round(p_amount, 2)
    else round(p_amount / v_booking.rate_snapshot, 2)
  end;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  v_kind := case when v_paid > 0 then 'balance' else 'deposit' end;

  -- Entra ya aprobado: lo registra quien verificó el dinero, no hay nada que
  -- volver a revisar en la bandeja.
  insert into payments (
    booking_id, kind, method, status, currency, amount, amount_usd, rate_used,
    reference, paid_at, admin_notes, reviewed_by, reviewed_at
  ) values (
    v_booking.id, v_kind, p_method, 'approved', p_currency, p_amount, v_amount_usd,
    case when p_currency = 'VES' then v_booking.rate_snapshot else null end,
    nullif(trim(p_reference), ''), now(), nullif(trim(p_notes), ''),
    v_staff, now()
  );

  v_settled := settle_booking(v_booking.id);

  return jsonb_build_object(
    'ok', true,
    'amount_usd', v_amount_usd,
    'confirmed', coalesce((v_settled->>'confirmed')::boolean, false),
    'paid_usd', (v_settled->>'paid_usd')::numeric
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirmar sin cobro
-- ---------------------------------------------------------------------------

create or replace function staff_confirm_booking(p_code text, p_reason text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking bookings%rowtype;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- El motivo es obligatorio: es lo único que explicará dentro de seis meses por
  -- qué esta reserva está confirmada sin un pago detrás.
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_reason');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_booking.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  update bookings
     set status = 'confirmed',
         expires_at = null,
         manual_confirmation_by = auth.uid(),
         manual_confirmation_reason = trim(p_reason),
         manual_confirmation_at = now(),
         updated_at = now()
   where id = v_booking.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelar
-- ---------------------------------------------------------------------------

-- Libera las fechas desactivando el hold. La reserva se conserva con su motivo:
-- borrarla perdería el historial de pagos y el rastro de qué pasó.
create or replace function staff_cancel_booking(p_code text, p_reason text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking bookings%rowtype;
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

  update bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = nullif(trim(p_reason), ''),
         expires_at = null,
         updated_at = now()
   where id = v_booking.id;

  update unit_holds set is_active = false where id = v_booking.hold_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function staff_record_payment from public, anon;
revoke all on function staff_confirm_booking from public, anon;
revoke all on function staff_cancel_booking from public, anon;
grant execute on function staff_record_payment to authenticated;
grant execute on function staff_confirm_booking to authenticated;
grant execute on function staff_cancel_booking to authenticated;
