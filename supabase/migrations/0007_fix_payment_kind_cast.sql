-- Corrige el tipo de `kind` en report_payment().
--
-- `case when ... then 'balance' else 'deposit' end` resuelve a text, y la columna
-- payments.kind es del enum payment_kind. Postgres no coerciona el resultado de
-- un CASE igual que un literal suelto, así que el INSERT fallaba con
-- "column kind is of type payment_kind but expression is of type text".

create or replace function report_payment(
  p_code           text,
  p_method         payment_method,
  p_currency       text,
  p_amount         numeric,
  p_origin         text default null,
  p_reference      text default null,
  p_paid_at        timestamptz default null,
  p_receipt_path   text default null,
  p_payer_name     text default null,
  p_payer_document text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking    bookings%rowtype;
  v_amount_usd numeric(12, 2);
  v_paid       numeric(12, 2);
  v_kind       payment_kind;
begin
  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_booking.status in ('cancelled', 'expired', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'booking_closed');
  end if;

  if p_currency not in ('USD', 'VES') then
    return jsonb_build_object('ok', false, 'error', 'invalid_currency');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  -- Un pago declarado con fecha futura es un error de captura o un intento de
  -- confundir la verificación.
  if p_paid_at is not null and p_paid_at > now() + interval '1 day' then
    return jsonb_build_object('ok', false, 'error', 'future_date');
  end if;

  v_amount_usd := case
    when p_currency = 'USD' then round(p_amount, 2)
    else round(p_amount / v_booking.rate_snapshot, 2)
  end;

  if v_amount_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  -- El primer pago verificado cubre el anticipo; lo que venga después es saldo.
  v_kind := case when v_paid > 0 then 'balance' else 'deposit' end;

  insert into payments (
    booking_id, kind, method, status, currency, amount, amount_usd, rate_used,
    origin, reference, paid_at, receipt_path, payer_name, payer_document
  ) values (
    v_booking.id, v_kind, p_method, 'verifying', p_currency, p_amount, v_amount_usd,
    case when p_currency = 'VES' then v_booking.rate_snapshot else null end,
    nullif(trim(p_origin), ''), nullif(trim(p_reference), ''),
    p_paid_at, p_receipt_path,
    nullif(trim(p_payer_name), ''), nullif(trim(p_payer_document), '')
  );

  -- Mientras haya un pago por verificar, la reserva no debe expirar bajo los
  -- pies del huésped que ya pagó. Se le da margen al administrador para revisar.
  update bookings
     set expires_at = greatest(coalesce(expires_at, now()), now() + interval '72 hours'),
         updated_at = now()
   where id = v_booking.id and status = 'pending';

  return jsonb_build_object('ok', true, 'amount_usd', v_amount_usd);
end;
$$;

revoke all on function report_payment from public;
grant execute on function report_payment to anon, authenticated;
