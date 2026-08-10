-- Reservas creadas por el operador.
--
-- El caso: el huésped llama, escribe por WhatsApp, o llega al mostrador. No usa
-- la web ni quiere hacerlo. El operador toma los datos y los registra.
--
-- Dos diferencias reales con una reserva hecha desde la web:
--
--   1. **Puede no haber correo.** Por WhatsApp lo normal es tener nombre y
--      teléfono. Obligar a inventar un correo ensucia los datos y provoca
--      rebotes que dañan la reputación de envío del dominio.
--
--   2. **El precio se negocia.** Descuento por estadía larga, cliente conocido,
--      temporada floja. La columna `discount_usd` existía sin usarse.

-- ---------------------------------------------------------------------------
-- Contacto: correo o teléfono, al menos uno
-- ---------------------------------------------------------------------------

alter table bookings alter column guest_email drop not null;

-- Sin ninguna vía de contacto la reserva es inútil: no hay forma de avisar al
-- huésped ni de que recupere su enlace.
alter table bookings add constraint bookings_has_contact
  check (guest_email is not null or guest_phone is not null);

comment on column bookings.guest_email is
  'Puede ser null en reservas tomadas por teléfono. El formulario público sí lo '
  'exige: es como el huésped recibe su enlace.';

-- ---------------------------------------------------------------------------
-- quote_stay() admite saltarse la antelación mínima
-- ---------------------------------------------------------------------------

-- Un operador puede cerrar una reserva para esta misma noche por teléfono. La
-- antelación mínima existe para la web, donde nadie confirma del otro lado.
drop function if exists quote_stay(uuid, date, date, int);

create or replace function quote_stay(
  p_unit_id     uuid,
  p_check_in    date,
  p_check_out   date,
  p_guests      int default 1,
  p_skip_notice boolean default false
)
returns jsonb
language plpgsql stable
as $$
declare
  v_unit      units%rowtype;
  v_settings  app_settings%rowtype;
  v_nights    int;
  v_subtotal  numeric(12, 2) := 0;
  v_min_req   int;
  v_night_min int;
  v_rate      numeric(18, 6);
  v_rate_date date;
  v_total     numeric(12, 2);
  v_night     date;
  v_price     numeric(10, 2);
begin
  select * into v_unit from units where id = p_unit_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unit_not_found');
  end if;

  select * into v_settings from app_settings;

  v_nights := p_check_out - p_check_in;
  if v_nights <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_dates');
  end if;

  if p_guests > v_unit.max_guests then
    return jsonb_build_object('ok', false, 'error', 'too_many_guests');
  end if;

  -- business_today(), no current_date: de noche el servidor ya está en mañana.
  if not p_skip_notice and p_check_in < business_today() + v_unit.advance_notice_days then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;

  -- Precio noche a noche: la temporada manda donde exista, si no la tarifa base.
  -- El mínimo de noches exigido es el más restrictivo de todas las temporadas
  -- que toca la estadía, así que se acumula en lugar de reasignarse.
  v_min_req := v_unit.min_nights;
  for v_night in select generate_series(p_check_in, p_check_out - 1, '1 day')::date loop
    select sr.price_usd, sr.min_nights
      into v_price, v_night_min
    from season_rates sr
    where sr.unit_id = p_unit_id and sr.period @> v_night;

    v_subtotal := v_subtotal + coalesce(v_price, v_unit.base_price_usd);
    v_min_req  := greatest(v_min_req, coalesce(v_night_min, v_unit.min_nights));
  end loop;

  -- El mínimo de noches también lo puede levantar el operador.
  if not p_skip_notice and v_nights < v_min_req then
    return jsonb_build_object('ok', false, 'error', 'below_min_nights', 'min_nights', v_min_req);
  end if;

  if v_unit.max_nights is not null and v_nights > v_unit.max_nights then
    return jsonb_build_object('ok', false, 'error', 'above_max_nights', 'max_nights', v_unit.max_nights);
  end if;

  if not is_available(p_unit_id, p_check_in, p_check_out) then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  v_total := v_subtotal + v_unit.cleaning_fee_usd;

  -- Antes que la tasa: si está rancia no se cotiza en bolívares. Cobrar con una
  -- tasa de hace días es pérdida de margen y factura no conforme.
  if rate_is_stale() then
    return jsonb_build_object('ok', false, 'error', 'stale_rate');
  end if;

  v_rate      := current_rate();
  v_rate_date := current_rate_date();

  if v_rate is null then
    return jsonb_build_object('ok', false, 'error', 'no_exchange_rate');
  end if;

  return jsonb_build_object(
    'ok',               true,
    'nights',           v_nights,
    'subtotal_usd',     v_subtotal,
    'cleaning_fee_usd', v_unit.cleaning_fee_usd,
    'total_usd',        v_total,
    'rate',             v_rate,
    'rate_date',        v_rate_date,
    'total_ves',        round(v_total * v_rate, 2),
    'deposit_ratio',    v_settings.default_deposit_ratio,
    'deposit_usd',      round(v_total * v_settings.default_deposit_ratio, 2)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Crear reserva desde el panel
-- ---------------------------------------------------------------------------

create or replace function staff_create_booking(
  p_unit_id        uuid,
  p_check_in       date,
  p_check_out      date,
  p_guests         int,
  p_guest_name     text,
  p_guest_email    text default null,
  p_guest_phone    text default null,
  p_guest_document text default null,
  p_notes          text default null,
  p_discount_usd   numeric default 0
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
  v_total    numeric(12, 2);
  v_rate     numeric(18, 6);
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if coalesce(trim(p_guest_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_name');
  end if;

  -- Al menos una vía de contacto, o la reserva no sirve para nada.
  if coalesce(trim(p_guest_email), '') = '' and coalesce(trim(p_guest_phone), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_contact');
  end if;

  if p_guest_email is not null and trim(p_guest_email) <> ''
     and trim(p_guest_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  -- El operador puede cerrar para hoy mismo y saltarse el mínimo de noches, pero
  -- no la disponibilidad: eso lo sigue decidiendo el EXCLUDE.
  v_quote := quote_stay(p_unit_id, p_check_in, p_check_out, p_guests, true);
  if not (v_quote->>'ok')::boolean then
    return v_quote;
  end if;

  v_rate  := (v_quote->>'rate')::numeric;
  v_total := (v_quote->>'total_usd')::numeric - greatest(coalesce(p_discount_usd, 0), 0);

  if v_total < 0 then
    return jsonb_build_object('ok', false, 'error', 'discount_too_large');
  end if;

  select * into v_settings from app_settings;

  begin
    insert into unit_holds (unit_id, stay, kind)
    values (p_unit_id, daterange(p_check_in, p_check_out, '[)'), 'booking')
    returning id into v_hold_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end;

  insert into bookings (
    unit_id, hold_id, status,
    check_in, check_out, guests,
    guest_name, guest_email, guest_phone, guest_document, notes,
    subtotal_usd, cleaning_fee_usd, discount_usd, total_usd,
    rate_snapshot, rate_date, total_ves,
    deposit_ratio, expires_at
  ) values (
    p_unit_id, v_hold_id, 'pending',
    p_check_in, p_check_out, p_guests,
    trim(p_guest_name),
    nullif(lower(trim(coalesce(p_guest_email, ''))), ''),
    nullif(trim(coalesce(p_guest_phone, '')), ''),
    nullif(trim(coalesce(p_guest_document, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    (v_quote->>'subtotal_usd')::numeric,
    (v_quote->>'cleaning_fee_usd')::numeric,
    greatest(coalesce(p_discount_usd, 0), 0),
    v_total,
    v_rate,
    (v_quote->>'rate_date')::date,
    round(v_total * v_rate, 2),
    v_settings.default_deposit_ratio,
    now() + make_interval(hours => v_settings.pending_ttl_hours)
  )
  returning * into v_booking;

  return jsonb_build_object(
    'ok',          true,
    'code',        v_booking.code,
    'total_usd',   v_booking.total_usd,
    'deposit_usd', round(v_booking.total_usd * v_booking.deposit_ratio, 2),
    'has_email',   v_booking.guest_email is not null
  );
end;
$$;

revoke all on function staff_create_booking from public, anon;
grant execute on function staff_create_booking to authenticated;
