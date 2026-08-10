-- Flujo de reserva: creación transaccional y reporte de pago.
--
-- Ambas operaciones las inicia gente sin sesión —se reserva sin cuenta—, así que
-- van como funciones SECURITY DEFINER en lugar de INSERT directos bajo RLS. Eso
-- permite mantener las tablas cerradas al público y que toda la validación viva
-- en un solo sitio, en vez de confiar en que el cliente mande datos coherentes.

-- ---------------------------------------------------------------------------
-- Crear reserva
-- ---------------------------------------------------------------------------

-- El hold y la reserva se crean en la misma transacción: si algo falla, no queda
-- ni un hold huérfano bloqueando fechas ni una reserva sin fechas retenidas.
--
-- La condición de carrera entre dos huéspedes pidiendo el mismo rango la resuelve
-- la restricción EXCLUDE de unit_holds, no una comprobación previa: entre el
-- "¿está libre?" y el INSERT siempre cabe otra transacción. Aquí se intenta
-- insertar y se captura la violación.
create or replace function create_booking(
  p_unit_id        uuid,
  p_check_in       date,
  p_check_out      date,
  p_guests         int,
  p_guest_name     text,
  p_guest_email    text,
  p_guest_phone    text default null,
  p_guest_document text default null,
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_quote    jsonb;
  v_settings app_settings%rowtype;
  v_hold_id  uuid;
  v_booking  bookings%rowtype;
begin
  if coalesce(trim(p_guest_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_name');
  end if;

  if p_guest_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  -- Autoridad única sobre precio y disponibilidad. Nada de lo que venga del
  -- cliente sobre montos se usa: se recalcula aquí.
  v_quote := quote_stay(p_unit_id, p_check_in, p_check_out, p_guests);
  if not (v_quote->>'ok')::boolean then
    return v_quote;
  end if;

  select * into v_settings from app_settings;

  begin
    insert into unit_holds (unit_id, stay, kind)
    values (p_unit_id, daterange(p_check_in, p_check_out, '[)'), 'booking')
    returning id into v_hold_id;
  exception when exclusion_violation then
    -- Otra reserva ganó la carrera entre la cotización y este insert.
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end;

  insert into bookings (
    unit_id, hold_id, guest_id, status,
    check_in, check_out, guests,
    guest_name, guest_email, guest_phone, guest_document, notes,
    subtotal_usd, cleaning_fee_usd, total_usd,
    rate_snapshot, rate_date, total_ves,
    deposit_ratio, expires_at
  ) values (
    p_unit_id, v_hold_id, auth.uid(), 'pending',
    p_check_in, p_check_out, p_guests,
    trim(p_guest_name), lower(trim(p_guest_email)), p_guest_phone, p_guest_document, p_notes,
    (v_quote->>'subtotal_usd')::numeric,
    (v_quote->>'cleaning_fee_usd')::numeric,
    (v_quote->>'total_usd')::numeric,
    (v_quote->>'rate')::numeric,
    (v_quote->>'rate_date')::date,
    (v_quote->>'total_ves')::numeric,
    (v_quote->>'deposit_ratio')::numeric,
    now() + make_interval(hours => v_settings.pending_ttl_hours)
  )
  returning * into v_booking;

  return jsonb_build_object(
    'ok',           true,
    'code',         v_booking.code,
    'total_usd',    v_booking.total_usd,
    'total_ves',    v_booking.total_ves,
    'deposit_usd',  round(v_booking.total_usd * v_booking.deposit_ratio, 2),
    'expires_at',   v_booking.expires_at
  );
end;
$$;

revoke all on function create_booking from public;
grant execute on function create_booking to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Consultar reserva por código
-- ---------------------------------------------------------------------------

-- El huésped gestiona su reserva por enlace, sin cuenta. El código es el secreto:
-- 8 caracteres hexadecimales aleatorios. No expone datos de otras reservas ni
-- permite enumerar, pero tampoco es una credencial fuerte — de ahí que solo
-- devuelva lo que el propio huésped ya conoce.
create or replace function get_booking(p_code text)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'code',           b.code,
    'status',         b.status,
    'check_in',       b.check_in,
    'check_out',      b.check_out,
    'nights',         b.nights,
    'guests',         b.guests,
    'guest_name',     b.guest_name,
    'guest_email',    b.guest_email,
    'unit_name',      u.name,
    'unit_slug',      u.slug,
    'total_usd',      b.total_usd,
    'total_ves',      b.total_ves,
    'rate_snapshot',  b.rate_snapshot,
    'rate_date',      b.rate_date,
    'rate_current',   b.rate_date = current_rate_date(),
    'deposit_ratio',  b.deposit_ratio,
    'deposit_usd',    round(b.total_usd * b.deposit_ratio, 2),
    'expires_at',     b.expires_at,
    'paid_usd',       coalesce((
      select sum(p.amount_usd) from payments p
      where p.booking_id = b.id and p.status = 'approved'
    ), 0),
    'payments',       coalesce((
      select jsonb_agg(jsonb_build_object(
        'method',           p.method,
        'status',           p.status,
        'currency',         p.currency,
        'amount',           p.amount,
        'reference',        p.reference,
        'created_at',       p.created_at,
        'rejection_reason', p.rejection_reason
      ) order by p.created_at)
      from payments p where p.booking_id = b.id
    ), '[]'::jsonb)
  )
  into v_result
  from bookings b
  join units u on u.id = b.unit_id
  where b.code = upper(trim(p_code));

  return coalesce(v_result, jsonb_build_object('error', 'not_found'));
end;
$$;

revoke all on function get_booking from public;
grant execute on function get_booking to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reportar pago
-- ---------------------------------------------------------------------------

-- El huésped declara canal, origen, referencia, monto y fecha, y adjunta la
-- captura. Entra como 'verifying': solo el administrador puede aprobarlo, y la
-- comprobación contra la cuenta real la hace una persona.
--
-- El monto en USD se deriva aquí, nunca se acepta del cliente. Para pagos en
-- bolívares se usa rate_snapshot —la tasa con la que se le cotizó— porque es la
-- que corresponde a la cifra que se le pidió pagar.
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

  insert into payments (
    booking_id, kind, method, status, currency, amount, amount_usd, rate_used,
    origin, reference, paid_at, receipt_path, payer_name, payer_document
  ) values (
    v_booking.id,
    case when v_paid > 0 then 'balance' else 'deposit' end,
    p_method, 'verifying', p_currency, p_amount, v_amount_usd,
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

-- ---------------------------------------------------------------------------
-- Recotizar el monto en bolívares
-- ---------------------------------------------------------------------------

-- La factura debe llevar el equivalente a la tasa de la fecha de la transacción.
-- Si la reserva se cotizó con una tasa que ya no rige, se recalcula la cifra en
-- bolívares. El total en dólares no se toca: ese es el precio pactado.
create or replace function refresh_booking_rate(p_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_rate    numeric(18, 6);
  v_date    date;
begin
  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if rate_is_stale() then
    return jsonb_build_object('ok', false, 'error', 'stale_rate');
  end if;

  v_rate := current_rate();
  v_date := current_rate_date();

  if v_booking.rate_date = v_date then
    return jsonb_build_object('ok', true, 'changed', false, 'total_ves', v_booking.total_ves);
  end if;

  update bookings
     set rate_snapshot = v_rate,
         rate_date     = v_date,
         total_ves     = round(total_usd * v_rate, 2),
         updated_at    = now()
   where id = v_booking.id
  returning * into v_booking;

  return jsonb_build_object(
    'ok', true, 'changed', true,
    'total_ves', v_booking.total_ves,
    'rate', v_rate, 'rate_date', v_date
  );
end;
$$;

revoke all on function refresh_booking_rate from public;
grant execute on function refresh_booking_rate to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Almacenamiento de comprobantes
-- ---------------------------------------------------------------------------

-- Bucket privado y sin ninguna política pública: nadie sube ni lee directamente.
-- Las subidas pasan por una acción de servidor que valida tipo y tamaño con la
-- clave de servicio, y las lecturas van por URL firmada de duración corta.
--
-- Dejarlo cerrado no es solo privacidad: una política de inserción anónima
-- permitiría a cualquiera llenar el gigabyte del plan gratuito.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false,
  400 * 1024,                      -- 400 KB; el servidor rechaza por encima de 300 KB
  array['image/webp', 'image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
