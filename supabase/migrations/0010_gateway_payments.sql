-- Cobros por pasarela.
--
-- Un pago de pasarela no pasa por la bandeja de verificación: el procesador ya
-- confirmó que el dinero se movió, así que entra directamente como 'approved'.
-- Lo que sí necesita es ser idempotente — los webhooks se reintentan y llegan
-- duplicados con normalidad— y compartir con la aprobación manual la regla de
-- cuándo una reserva queda confirmada.

alter table payments
  add column if not exists provider text,
  add column if not exists provider_ref text;

comment on column payments.provider is
  'Pasarela que procesó el cobro (stripe, c2p…). Null en pagos reportados a mano.';
comment on column payments.provider_ref is
  'Identificador del cobro en la pasarela. Único por proveedor: es lo que hace '
  'idempotente el webhook, que se reintenta y llega duplicado con normalidad.';

create unique index if not exists payments_provider_ref_unique
  on payments (provider, provider_ref)
  where provider is not null and provider_ref is not null;

-- ---------------------------------------------------------------------------
-- Regla única de confirmación
-- ---------------------------------------------------------------------------

-- Cuándo una reserva pasa de pendiente a confirmada. La usan por igual la
-- aprobación manual del administrador y el webhook de la pasarela: si viviera
-- duplicada en los dos sitios, acabarían divergiendo.
create or replace function settle_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking  bookings%rowtype;
  v_paid     numeric(12, 2);
  v_required numeric(12, 2);
begin
  select * into v_booking from bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  v_required := v_booking.total_usd * v_booking.deposit_ratio;

  -- El margen de un centavo absorbe el redondeo al convertir pagos en bolívares:
  -- sin él, un anticipo exacto quedaría corto por milésimas y la reserva no se
  -- confirmaría nunca.
  if v_booking.status = 'pending' and v_paid + 0.01 >= v_required then
    update bookings
       set status = 'confirmed', expires_at = null, updated_at = now()
     where id = v_booking.id;

    return jsonb_build_object('ok', true, 'confirmed', true, 'paid_usd', v_paid);
  end if;

  return jsonb_build_object('ok', true, 'confirmed', false, 'paid_usd', v_paid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Registro de un cobro de pasarela
-- ---------------------------------------------------------------------------

-- Devuelve `duplicate` en vez de fallar cuando el webhook se repite: un
-- reintento de Stripe no es un error, y responder con un fallo haría que
-- siguiera reintentando indefinidamente.
create or replace function record_gateway_payment(
  p_code         text,
  p_provider     text,
  p_provider_ref text,
  p_method       payment_method,
  p_currency     text,
  p_amount       numeric,
  p_amount_usd   numeric,
  p_payload      jsonb default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_kind    payment_kind;
  v_paid    numeric(12, 2);
  v_settled jsonb;
begin
  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if exists (
    select 1 from payments
    where provider = p_provider and provider_ref = p_provider_ref
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'code', v_booking.code);
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  v_kind := case when v_paid > 0 then 'balance' else 'deposit' end;

  insert into payments (
    booking_id, kind, method, status, currency, amount, amount_usd,
    provider, provider_ref, reference, paid_at, gateway_payload
  ) values (
    v_booking.id, v_kind, p_method, 'approved', p_currency, p_amount, p_amount_usd,
    p_provider, p_provider_ref, p_provider_ref, now(), p_payload
  );

  v_settled := settle_booking(v_booking.id);

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'code', v_booking.code,
    'confirmed', coalesce((v_settled->>'confirmed')::boolean, false)
  );
end;
$$;

-- Solo el servidor las invoca, con la clave de servicio.
revoke all on function settle_booking from public, anon, authenticated;
revoke all on function record_gateway_payment from public, anon, authenticated;
