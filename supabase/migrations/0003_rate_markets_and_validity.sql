-- Mercados de tasa, guardia de tasa rancia y vigencia del monto en bolívares.
--
-- Contexto legal: la Ley de Precios Justos (art. 46 núm. 5) obliga a operar a la
-- tasa oficial del BCV, y la factura debe llevar el equivalente en bolívares a
-- la tasa **de la fecha de la transacción**. También está prohibido ofrecer
-- precio más bajo por pagar en divisa.
--
-- De ahí tres cambios:
--
-- 1. `exchange_rates` distingue MERCADO (oficial / paralelo) de PROVEEDOR
--    (bcv / dolarapi). El paralelo se registra solo como métrica de brecha para
--    ayudar a fijar el precio de lista en USD. Nunca se cobra con él.
--
-- 2. El monto en bolívares de una reserva vale mientras rija esa tasa. Al
--    cambiar la fecha valor hay que recalcularlo, que es justo lo que la ley
--    pide y además elimina la pérdida por deriva (~0,45%/día).
--
-- 3. Si la tasa vigente está rancia —el cron lleva días caído— se deja de
--    cotizar en vez de cobrar con un dato viejo.

-- ---------------------------------------------------------------------------
-- Mercado en exchange_rates
-- ---------------------------------------------------------------------------

alter table exchange_rates
  add column if not exists market text not null default 'oficial'
    check (market in ('oficial', 'paralelo'));

comment on column exchange_rates.market is
  'oficial = BCV, única legal para cobrar. paralelo = referencia informal, solo '
  'métrica de brecha; current_rate() la ignora.';

comment on column exchange_rates.source is
  'Proveedor del dato (bcv, dolarapi). Distinto de market, que es el mercado.';

-- Una fila por día y mercado. El paralelo cambia varias veces al día; guardar
-- la última lectura de la jornada basta para medir la brecha y mantiene la
-- tabla diminuta frente a los 500 MB del plan gratuito.
alter table exchange_rates drop constraint exchange_rates_pkey;
alter table exchange_rates add primary key (rate_date, market);

-- ---------------------------------------------------------------------------
-- Tasa vigente y su fecha valor
-- ---------------------------------------------------------------------------

create or replace function current_rate()
returns numeric
language sql stable
as $$
  select usd_ves
  from exchange_rates
  where market = 'oficial'
    and rate_date <= business_today()
  order by rate_date desc
  limit 1;
$$;

-- Fecha valor de la tasa vigente. Es lo que se congela en la reserva para saber
-- después si el monto en bolívares sigue siendo el correcto.
create or replace function current_rate_date()
returns date
language sql stable
as $$
  select rate_date
  from exchange_rates
  where market = 'oficial'
    and rate_date <= business_today()
  order by rate_date desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Guardia de tasa rancia
-- ---------------------------------------------------------------------------

-- El BCV no publica sábados, domingos ni feriados, así que un hueco de hasta
-- tres días es normal. Más que eso significa que el alimentador lleva días sin
-- correr, y cotizar con esa tasa sería a la vez incorrecto y no conforme.
create or replace function rate_is_stale()
returns boolean
language sql stable
as $$
  select coalesce(business_today() - current_rate_date() > 3, true);
$$;

comment on function rate_is_stale() is
  'Cierto si la tasa vigente tiene más de 3 días de fecha valor, o si no hay '
  'ninguna. Tolera fin de semana largo; delata un cron caído.';

-- ---------------------------------------------------------------------------
-- Brecha cambiaria — solo observabilidad
-- ---------------------------------------------------------------------------

-- Fracción por la que el paralelo supera al oficial en su última lectura común.
-- Sirve para decidir el precio de lista en USD, que es la única palanca legal
-- frente a la brecha. No interviene en ningún cobro.
create or replace function current_gap()
returns numeric
language sql stable
as $$
  with oficial as (
    select rate_date, usd_ves from exchange_rates
    where market = 'oficial' and rate_date <= business_today()
    order by rate_date desc limit 1
  ), paralelo as (
    select rate_date, usd_ves from exchange_rates
    where market = 'paralelo' and rate_date <= business_today()
    order by rate_date desc limit 1
  )
  select round((paralelo.usd_ves - oficial.usd_ves) / oficial.usd_ves, 6)
  from oficial, paralelo;
$$;

-- ---------------------------------------------------------------------------
-- Vigencia del monto en bolívares de una reserva
-- ---------------------------------------------------------------------------

-- Fecha valor de la tasa con la que se calculó total_ves. Si deja de coincidir
-- con current_rate_date(), el monto en bolívares hay que recalcularlo: la
-- reserva sigue viva, lo que caduca es la cifra en Bs.
alter table bookings
  add column if not exists rate_date date;

comment on column bookings.rate_date is
  'Fecha valor de rate_snapshot. El monto en bolívares vale mientras coincida '
  'con current_rate_date(); al cambiar, se recotiza.';

-- Las reservas ya existentes se asumen cotizadas con la tasa vigente al crearse.
update bookings set rate_date = current_rate_date() where rate_date is null;

create index if not exists bookings_rate_date_idx on bookings (rate_date)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- quote_stay(): fecha valor en la respuesta y rechazo si la tasa está rancia
-- ---------------------------------------------------------------------------

create or replace function quote_stay(p_unit_id uuid, p_check_in date, p_check_out date, p_guests int default 1)
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
  if p_check_in < business_today() + v_unit.advance_notice_days then
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

  if v_nights < v_min_req then
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
