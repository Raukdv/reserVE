-- Dos formas de reembolso, y la base sobre la que se calcula cada una.
--
-- El primer intento asumía un único tipo de tramo: un porcentaje de lo pagado.
-- No es como funcionan las políticas reales. Hay dos formas distintas:
--
--   percent  X % del total por noches. Con X = 100 vuelve todo, limpieza
--            incluida. Por debajo, la limpieza no se devuelve.
--
--   nights   Se pierden las primeras N noches y se devuelve el resto.
--            Es el «get back every night but the first one» de las plataformas.
--            La limpieza tampoco vuelve.
--
-- En los dos casos lo que se paga de vuelta está topado por lo efectivamente
-- cobrado: nadie devuelve dinero que nunca recibió. Se distingue por eso entre
-- lo que le corresponde al huésped (`entitlement`) y lo que se le devuelve.

-- ---------------------------------------------------------------------------
-- Precio de una noche concreta
-- ---------------------------------------------------------------------------

-- Con temporadas, las noches de una misma estadía no valen lo mismo. Perder «la
-- primera noche» en Carnaval no es lo mismo que un martes de mayo, así que se
-- mira el precio real de esa fecha y no el promedio de la reserva.
create or replace function night_price(p_unit_id uuid, p_night date)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select sr.price_usd from season_rates sr
      where sr.unit_id = p_unit_id and sr.period @> p_night),
    (select u.base_price_usd from units u where u.id = p_unit_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Tramos con tipo
-- ---------------------------------------------------------------------------

-- Los tramos existentes eran todos de porcentaje; se les añade el tipo.
update app_settings
   set cancellation_tiers = (
     select jsonb_agg(
       case when tier ? 'kind' then tier
            else tier || '{"kind":"percent"}'::jsonb end
       order by (tier->>'hours_before')::numeric desc
     )
     from jsonb_array_elements(cancellation_tiers) tier
   )
 where jsonb_typeof(cancellation_tiers) = 'array';

comment on column app_settings.cancellation_tiers is
  'Escalera de reembolso, de mayor a menor antelación. Cada tramo: '
  '{hours_before, kind: percent|nights, refund_percent | forfeit_nights}. '
  'Lo no cubierto por ningún tramo no se reembolsa.';

-- ---------------------------------------------------------------------------
-- Cálculo del reembolso
-- ---------------------------------------------------------------------------

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
  v_forfeit   int;
  v_lost      numeric(12, 2) := 0;
  v_entitled  numeric(12, 2) := 0;
  v_cleaning  boolean := false;
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

  -- Primer tramo cuyo plazo todavía no ha vencido.
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
    -- Fuera de todo tramo: no se devuelve nada.
    return jsonb_build_object(
      'ok', true, 'paid_usd', v_paid, 'entitlement_usd', 0, 'refund_usd', 0,
      'kind', 'none', 'nights_total', v_booking.nights, 'nights_refunded', 0,
      'cleaning_refunded', false, 'check_in_at', v_deadline
    );
  end if;

  v_kind := coalesce(v_match->>'kind', 'percent');

  if v_kind = 'nights' then
    -- Se pierden las primeras N noches, a su precio real.
    v_forfeit := least(coalesce((v_match->>'forfeit_nights')::int, 1), v_booking.nights);

    select coalesce(sum(night_price(v_booking.unit_id, n::date)), 0) into v_lost
    from generate_series(
      v_booking.check_in,
      v_booking.check_in + (v_forfeit - 1),
      '1 day'
    ) n
    where v_forfeit > 0;

    v_refunded := v_booking.nights - v_forfeit;
    v_entitled := greatest(v_booking.subtotal_usd - v_lost, 0);

  else
    -- Porcentaje del total por noches. Solo el 100 % arrastra la limpieza.
    v_entitled := round(v_booking.subtotal_usd * coalesce((v_match->>'refund_percent')::numeric, 0) / 100.0, 2);
    v_refunded := v_booking.nights;

    if coalesce((v_match->>'refund_percent')::numeric, 0) >= 100 then
      v_cleaning := true;
      v_entitled := v_entitled + v_booking.cleaning_fee_usd;
    end if;
  end if;

  -- El descuento pactado reduce lo que llegó a deberse, así que también reduce
  -- lo reembolsable.
  v_entitled := greatest(v_entitled - v_booking.discount_usd, 0);

  return jsonb_build_object(
    'ok',                true,
    'paid_usd',          v_paid,
    'entitlement_usd',   v_entitled,
    -- Topado por lo cobrado: no se devuelve lo que nunca entró.
    'refund_usd',        least(v_entitled, v_paid),
    'kind',              v_kind,
    'refund_percent',    (v_match->>'refund_percent')::int,
    'forfeit_nights',    v_forfeit,
    'forfeited_usd',     v_lost,
    'nights_total',      v_booking.nights,
    'nights_refunded',   v_refunded,
    'cleaning_refunded', v_cleaning,
    'check_in_at',       v_deadline
  );
end;
$$;

revoke all on function cancellation_quote from public;
grant execute on function cancellation_quote to anon, authenticated;
