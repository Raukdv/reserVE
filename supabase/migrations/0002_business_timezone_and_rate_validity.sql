-- Fecha de negocio y vigencia de la tasa BCV.
--
-- Dos correcciones relacionadas:
--
-- 1. Postgres corre en UTC y el negocio opera en Venezuela (UTC−4). Entre las
--    8 de la noche y la medianoche hora local, `current_date` ya es el día
--    siguiente, así que cualquier regla que dependa de "hoy" —la antelación
--    mínima, la tasa vigente— se corría un día durante ese tramo.
--
-- 2. El BCV publica la tasa de lunes a viernes entre las 4 y las 5 de la tarde,
--    y esa tasa entra en vigencia para el día hábil SIGUIENTE. Guardarla contra
--    la fecha en que se descargó es incorrecto: hay que guardarla contra su
--    fecha valor, y al cotizar usar la que ya esté vigente, no la más reciente
--    publicada.

-- ---------------------------------------------------------------------------
-- Fecha de negocio
-- ---------------------------------------------------------------------------

-- El día actual según la zona horaria del negocio, no la del servidor.
create or replace function business_today()
returns date
language sql stable
as $$
  select (now() at time zone 'America/Caracas')::date;
$$;

comment on function business_today() is
  'Fecha actual en la zona del negocio. Usar en lugar de current_date en toda '
  'regla de calendario: el servidor corre en UTC y Venezuela va UTC−4.';

-- ---------------------------------------------------------------------------
-- Tasa vigente
-- ---------------------------------------------------------------------------

-- `rate_date` pasa a significar FECHA VALOR: el día para el que rige la tasa,
-- tal como lo publica el BCV, no el día en que se descargó.
comment on column exchange_rates.rate_date is
  'Fecha valor publicada por el BCV: el día hábil para el que rige esta tasa. '
  'La tasa publicada entre 4 y 5 PM rige para el día siguiente.';

-- La tasa vigente es la de mayor fecha valor que ya haya entrado en vigencia.
-- Tomar simplemente la más reciente devolvería la tasa de mañana durante la
-- tarde de hoy, y se cobraría con una tasa que aún no aplica.
create or replace function current_rate()
returns numeric
language sql stable
as $$
  select usd_ves
  from exchange_rates
  where rate_date <= business_today()
  order by rate_date desc
  limit 1;
$$;

comment on function current_rate() is
  'Tasa BCV vigente hoy según fecha valor. Ignora tasas ya publicadas cuya '
  'vigencia empieza en el futuro.';

-- ---------------------------------------------------------------------------
-- quote_stay(): misma lógica, con fecha de negocio
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
  v_rate  := current_rate();

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
    'total_ves',        round(v_total * v_rate, 2),
    'deposit_ratio',    v_settings.default_deposit_ratio,
    'deposit_usd',      round(v_total * v_settings.default_deposit_ratio, 2)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Registro de ejecución del alimentador
-- ---------------------------------------------------------------------------

-- El plan Hobby de Vercel retiene solo una hora de logs, así que el resultado
-- de cada corrida del cron se guarda aquí. También sirve para comprobar de un
-- vistazo que el latido contra la pausa por inactividad de Supabase sigue vivo.
create table if not exists rate_fetch_log (
  id         bigserial primary key,
  ran_at     timestamptz not null default now(),
  ok         boolean not null,
  rate_date  date,
  usd_ves    numeric(18, 6),
  source     text,
  detail     text
);

create index if not exists rate_fetch_log_ran_at_idx on rate_fetch_log (ran_at desc);

alter table rate_fetch_log enable row level security;

create policy rate_fetch_log_staff on rate_fetch_log
  for select using (is_staff());

-- Conserva 90 días. Sin esto la tabla crece sin techo contra los 500 MB del
-- plan gratuito de Supabase.
create or replace function prune_rate_fetch_log()
returns void
language sql
security definer set search_path = public
as $$
  delete from rate_fetch_log where ran_at < now() - interval '90 days';
$$;
