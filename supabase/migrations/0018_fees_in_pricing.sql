-- Los cargos entran en la cotización, la reserva y el reembolso.

-- ---------------------------------------------------------------------------
-- Cotización
-- ---------------------------------------------------------------------------

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
  v_fees      jsonb;
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

  if not p_skip_notice and p_check_in < business_today() + v_unit.advance_notice_days then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;

  v_min_req := v_unit.min_nights;
  for v_night in select generate_series(p_check_in, p_check_out - 1, '1 day')::date loop
    select sr.price_usd, sr.min_nights
      into v_price, v_night_min
    from season_rates sr
    where sr.unit_id = p_unit_id and sr.period @> v_night;

    v_subtotal := v_subtotal + coalesce(v_price, v_unit.base_price_usd);
    v_min_req  := greatest(v_min_req, coalesce(v_night_min, v_unit.min_nights));
  end loop;

  if not p_skip_notice and v_nights < v_min_req then
    return jsonb_build_object('ok', false, 'error', 'below_min_nights', 'min_nights', v_min_req);
  end if;

  if v_unit.max_nights is not null and v_nights > v_unit.max_nights then
    return jsonb_build_object('ok', false, 'error', 'above_max_nights', 'max_nights', v_unit.max_nights);
  end if;

  if not is_available(p_unit_id, p_check_in, p_check_out) then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  -- Los cargos se calculan sobre la estadía ya valorada: los porcentajes
  -- necesitan una base y esa base son las noches más los cargos de monto.
  v_fees  := compute_fees(p_unit_id, v_nights, p_guests, v_subtotal);
  v_total := v_subtotal + (v_fees->>'total_usd')::numeric;

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
    'fees',             v_fees->'items',
    'fees_usd',         (v_fees->>'total_usd')::numeric,
    -- Se mantiene por compatibilidad con lo que ya lee la interfaz.
    'cleaning_fee_usd', (v_fees->>'total_usd')::numeric,
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
-- Creación de reservas: se congela el desglose
-- ---------------------------------------------------------------------------

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
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end;

  insert into bookings (
    unit_id, hold_id, guest_id, status,
    check_in, check_out, guests,
    guest_name, guest_email, guest_phone, guest_document, notes,
    subtotal_usd, cleaning_fee_usd, fees_usd, fees_breakdown, total_usd,
    rate_snapshot, rate_date, total_ves,
    deposit_ratio, expires_at
  ) values (
    p_unit_id, v_hold_id, auth.uid(), 'pending',
    p_check_in, p_check_out, p_guests,
    trim(p_guest_name), lower(trim(p_guest_email)), p_guest_phone, p_guest_document, p_notes,
    (v_quote->>'subtotal_usd')::numeric,
    (v_quote->>'fees_usd')::numeric,
    (v_quote->>'fees_usd')::numeric,
    coalesce(v_quote->'fees', '[]'::jsonb),
    (v_quote->>'total_usd')::numeric,
    (v_quote->>'rate')::numeric,
    (v_quote->>'rate_date')::date,
    (v_quote->>'total_ves')::numeric,
    (v_quote->>'deposit_ratio')::numeric,
    now() + make_interval(hours => v_settings.pending_ttl_hours)
  )
  returning * into v_booking;

  return jsonb_build_object(
    'ok', true, 'code', v_booking.code,
    'total_usd', v_booking.total_usd, 'total_ves', v_booking.total_ves,
    'deposit_usd', round(v_booking.total_usd * v_booking.deposit_ratio, 2),
    'expires_at', v_booking.expires_at
  );
end;
$$;

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

  if coalesce(trim(p_guest_email), '') = '' and coalesce(trim(p_guest_phone), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_contact');
  end if;

  if p_guest_email is not null and trim(p_guest_email) <> ''
     and trim(p_guest_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

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
    subtotal_usd, cleaning_fee_usd, fees_usd, fees_breakdown, discount_usd, total_usd,
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
    (v_quote->>'fees_usd')::numeric,
    (v_quote->>'fees_usd')::numeric,
    coalesce(v_quote->'fees', '[]'::jsonb),
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
    'ok', true, 'code', v_booking.code,
    'total_usd', v_booking.total_usd,
    'deposit_usd', round(v_booking.total_usd * v_booking.deposit_ratio, 2),
    'has_email', v_booking.guest_email is not null
  );
end;
$$;

revoke all on function create_booking from public;
grant execute on function create_booking to anon, authenticated;
revoke all on function staff_create_booking from public, anon;
grant execute on function staff_create_booking to authenticated;

-- ---------------------------------------------------------------------------
-- Reembolso con cargos
-- ---------------------------------------------------------------------------

-- Regla:
--   · Los cargos marcados como reembolsables siguen la misma suerte que las
--     noches: se devuelven en la proporción que corresponda al tramo.
--   · Los no reembolsables se pierden en cuanto el tramo deja de ser completo.
--   · Los porcentajes no tienen bandera: siguen a su base y se devuelven en
--     proporción a lo que se reembolse de ella. Un impuesto sobre un servicio
--     que se devuelve, se devuelve.
create or replace function cancellation_quote(p_code text)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_booking   bookings%rowtype;
  v_settings  app_settings%rowtype;
  v_deadline  timestamptz;
  v_paid      numeric(12, 2);
  v_tier      jsonb;
  v_match     jsonb;
  v_kind      text;
  v_forfeit   int := 0;
  v_lost      numeric(12, 2) := 0;
  v_nights_kept numeric(12, 2) := 0;
  v_fee       jsonb;
  v_fees_back numeric(12, 2) := 0;
  v_pct_fees  numeric(12, 2) := 0;
  v_base      numeric(12, 2) := 0;
  v_entitled  numeric(12, 2) := 0;
  v_refunded  int := 0;
begin
  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_settings from app_settings;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  v_deadline := (v_booking.check_in + v_settings.check_in_time)
                  at time zone 'America/Caracas';

  for v_tier in
    select value from jsonb_array_elements(v_settings.cancellation_tiers)
     order by (value->>'hours_before')::numeric desc
  loop
    if now() <= v_deadline - make_interval(hours => (v_tier->>'hours_before')::int) then
      v_match := v_tier;
      exit;
    end if;
  end loop;

  if v_match is null then
    return jsonb_build_object(
      'ok', true, 'paid_usd', v_paid, 'entitlement_usd', 0, 'refund_usd', 0,
      'kind', 'none', 'nights_total', v_booking.nights, 'nights_refunded', 0,
      'fees_refunded_usd', 0, 'check_in_at', v_deadline
    );
  end if;

  v_kind := coalesce(v_match->>'kind', 'percent');

  -- Reembolso completo: vuelve todo, sin distinguir cargos.
  if v_kind = 'percent' and coalesce((v_match->>'refund_percent')::numeric, 0) >= 100 then
    return jsonb_build_object(
      'ok', true, 'paid_usd', v_paid,
      'entitlement_usd', v_booking.total_usd,
      'refund_usd', least(v_booking.total_usd, v_paid),
      'kind', 'percent', 'refund_percent', 100,
      'nights_total', v_booking.nights, 'nights_refunded', v_booking.nights,
      'fees_refunded_usd', v_booking.fees_usd, 'cleaning_refunded', true,
      'check_in_at', v_deadline
    );
  end if;

  -- Parte de las noches que se conserva.
  if v_kind = 'nights' then
    v_forfeit := least(coalesce((v_match->>'forfeit_nights')::int, 1), v_booking.nights);

    select coalesce(sum(night_price(v_booking.unit_id, n::date)), 0) into v_lost
    from generate_series(v_booking.check_in, v_booking.check_in + (v_forfeit - 1), '1 day') n
    where v_forfeit > 0;

    v_nights_kept := greatest(v_booking.subtotal_usd - v_lost, 0);
    v_refunded    := v_booking.nights - v_forfeit;
  else
    v_nights_kept := round(
      v_booking.subtotal_usd * coalesce((v_match->>'refund_percent')::numeric, 0) / 100.0, 2);
    v_refunded    := v_booking.nights;
  end if;

  -- Cargos de monto marcados como reembolsables, en la misma proporción.
  for v_fee in select value from jsonb_array_elements(v_booking.fees_breakdown)
  loop
    if v_fee->>'kind' <> 'percent' and coalesce((v_fee->>'refundable')::boolean, false) then
      v_fees_back := v_fees_back + case
        when v_booking.subtotal_usd > 0
          then round((v_fee->>'amount_usd')::numeric * v_nights_kept / v_booking.subtotal_usd, 2)
        else 0 end;
    end if;
  end loop;

  -- Base reembolsable: noches conservadas más cargos que las acompañan.
  v_base := v_nights_kept + v_fees_back;

  -- Los porcentajes siguen a su base.
  for v_fee in select value from jsonb_array_elements(v_booking.fees_breakdown)
  loop
    if v_fee->>'kind' = 'percent' and coalesce((v_fee->>'base_usd')::numeric, 0) > 0 then
      v_pct_fees := v_pct_fees + round(
        (v_fee->>'amount_usd')::numeric * v_base / (v_fee->>'base_usd')::numeric, 2);
    end if;
  end loop;

  v_entitled := greatest(v_base + v_pct_fees - v_booking.discount_usd, 0);

  return jsonb_build_object(
    'ok',                true,
    'paid_usd',          v_paid,
    'entitlement_usd',   v_entitled,
    'refund_usd',        least(v_entitled, v_paid),
    'kind',              v_kind,
    'refund_percent',    (v_match->>'refund_percent')::int,
    'forfeit_nights',    v_forfeit,
    'forfeited_usd',     v_lost,
    'nights_total',      v_booking.nights,
    'nights_refunded',   v_refunded,
    'fees_refunded_usd', round(v_fees_back + v_pct_fees, 2),
    'cleaning_refunded', v_fees_back > 0,
    'check_in_at',       v_deadline
  );
end;
$$;

revoke all on function cancellation_quote from public;
grant execute on function cancellation_quote to anon, authenticated;
