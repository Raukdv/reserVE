-- Separar los impuestos de los ingresos.
--
-- ## El problema
--
-- El IVA no es del negocio. Se cobra al huésped, se recauda por cuenta del fisco
-- y se entera. Contarlo como ingreso infla la cifra en la proporción exacta del
-- tipo impositivo — con el 16 % venezolano, casi una séptima parte de lo que la
-- gráfica diría que se ganó.
--
-- Y la tabla `fees` no tenía forma de decirlo. Un cargo `percent` llamado «IVA»
-- y otro llamado «Recargo de temporada alta» eran indistinguibles para el
-- código: el segundo sí es ingreso, el primero no.
--
-- El IGTF nunca tuvo este problema. Vive en `payments.igtf_usd`, fuera de
-- `amount_usd`, desde la `0024`. El IVA sí es un cargo, y ahí se mezclaba.
--
-- ## Por qué una bandera propia y no `refundable`
--
-- Son cosas distintas y además no correlacionan: un impuesto **sí** se devuelve
-- al huésped si se le devuelve la estadía, porque el hecho imponible se deshace.
-- `refundable` responde «¿vuelve este dinero al huésped?»; `is_tax` responde
-- «¿es este dinero mío?». Un cargo puede ser cualquier combinación de las dos.
--
-- ## Qué no cambia
--
-- Nada del cobro. Al huésped se le cobra lo mismo, el anticipo se sigue
-- calculando sobre el total con impuestos —artículo 13 de la Ley del IVA, ver
-- `docs/funciones/cobro-y-verificacion.md`— y las devoluciones siguen devolviendo
-- la parte proporcional. Esto es solo **cómo se cuenta**.
--
-- ## Sobre lo ya cobrado
--
-- No hace falta migrar nada: al aplicar esto no existía ningún cargo creado ni
-- ninguna reserva con desglose. Si hubiera habido historia, el desglose
-- congelado en `bookings.fees_breakdown` no llevaría la marca y habría que
-- rellenarlo cruzando por el `id` del cargo, o declarar la cifra histórica sin
-- separar. Queda dicho por si alguien lee esto con datos delante.

alter table fees
  add column if not exists is_tax boolean not null default false;

comment on column fees.is_tax is
  'Cierto si el cargo es un tributo que el negocio recauda y entera (IVA, tasa '
  'turística). Se cobra al huésped pero no es ingreso. Independiente de '
  'refundable: un impuesto se devuelve si se devuelve la estadía.';

-- ---------------------------------------------------------------------------
-- Cálculo
-- ---------------------------------------------------------------------------

-- Mismo cálculo de siempre; lo que se añade es la marca en cada línea del
-- desglose y dos totales nuevos. El desglose es una foto congelada en la
-- reserva, así que la marca tiene que ir dentro: mirar la tabla `fees` seis
-- meses después diría cómo está configurado el cargo hoy, no cómo se cobró.
create or replace function compute_fees(
  p_unit_id  uuid,
  p_nights   integer,
  p_guests   integer,
  p_subtotal numeric
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_fee    record;
  v_amount numeric(12, 2);
  v_base   numeric(12, 2) := p_subtotal;
  v_items  jsonb := '[]'::jsonb;
  v_total  numeric(12, 2) := 0;
  v_tax    numeric(12, 2) := 0;
begin
  -- Primera pasada: montos.
  for v_fee in
    select * from fees
     where is_active
       and (unit_id is null or unit_id = p_unit_id)
       and kind <> 'percent'
     order by unit_id nulls first, sort_order, name
  loop
    v_amount := round(
      case v_fee.kind
        when 'fixed'     then v_fee.amount
        when 'per_night' then v_fee.amount * p_nights
        when 'per_guest' then v_fee.amount * p_guests
      end, 2);

    if v_amount > 0 then
      v_base  := v_base + v_amount;
      v_total := v_total + v_amount;
      if v_fee.is_tax then v_tax := v_tax + v_amount; end if;

      v_items := v_items || jsonb_build_object(
        'id', v_fee.id, 'name', v_fee.name, 'kind', v_fee.kind,
        'rate', v_fee.amount, 'amount_usd', v_amount,
        'refundable', v_fee.refundable, 'is_tax', v_fee.is_tax, 'scope',
        case when v_fee.unit_id is null then 'general' else 'unit' end
      );
    end if;
  end loop;

  -- Segunda pasada: porcentajes sobre la base ya formada.
  --
  -- Ojo: la base es el subtotal más los cargos de monto, así que un porcentaje
  -- no grava a otro porcentaje. Para el IVA sobre la limpieza está bien; si
  -- alguna vez se crea un recargo de temporada como porcentaje, el IVA no caerá
  -- sobre él. Se deja como estaba: cambiarlo cambiaría lo que se cobra.
  for v_fee in
    select * from fees
     where is_active
       and (unit_id is null or unit_id = p_unit_id)
       and kind = 'percent'
     order by unit_id nulls first, sort_order, name
  loop
    v_amount := round(v_base * v_fee.amount / 100.0, 2);

    if v_amount > 0 then
      v_total := v_total + v_amount;
      if v_fee.is_tax then v_tax := v_tax + v_amount; end if;

      v_items := v_items || jsonb_build_object(
        'id', v_fee.id, 'name', v_fee.name, 'kind', 'percent',
        'rate', v_fee.amount, 'amount_usd', v_amount,
        -- Un porcentaje sigue a su base: se reembolsa en proporción a lo que
        -- se reembolse de ella, sin bandera propia.
        'refundable', true,
        'is_tax', v_fee.is_tax,
        'base_usd', v_base,
        'scope', case when v_fee.unit_id is null then 'general' else 'unit' end
      );
    end if;
  end loop;

  return jsonb_build_object(
    'items',     v_items,
    'total_usd', v_total,
    'tax_usd',   v_tax,
    'base_usd',  v_base
  );
end;
$$;

comment on function compute_fees is
  'Desglose de cargos de una estadía. Devuelve items, total_usd, tax_usd —lo '
  'que se recauda por cuenta del fisco— y base_usd.';

-- ---------------------------------------------------------------------------
-- La cotización expone las dos cifras
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.quote_stay(p_unit_id uuid, p_check_in date, p_check_out date, p_guests integer DEFAULT 1, p_skip_notice boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $$
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
  v_igtf      numeric(12, 2) := 0;
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

  -- Proyección, no cargo. La estadía cuesta lo mismo; el impuesto aparece solo
  -- si se paga en divisas, y aquí todavía no se sabe. Se aplica sobre el total
  -- ya compuesto porque la base del IGTF incluye los demás impuestos.
  if coalesce(v_settings.igtf_enabled, false) then
    v_igtf := round(v_total * v_settings.igtf_rate, 2);
  end if;

  return jsonb_build_object(
    'ok',           true,
    'nights',       v_nights,
    'subtotal_usd', v_subtotal,
    'fees',         v_fees->'items',
    'fees_usd',     (v_fees->>'total_usd')::numeric,
    'total_usd',    v_total,
    -- Lo que se recauda por cuenta del fisco y lo que queda para el negocio.
    -- No cambia lo que paga el huesped: cambia como se cuenta.
    'tax_usd',      (v_fees->>'tax_usd')::numeric,
    'net_usd',      v_total - (v_fees->>'tax_usd')::numeric,
    'rate',         v_rate,
    'rate_date',    v_rate_date,
    'total_ves',    round(v_total * v_rate, 2),
    'deposit_ratio', v_settings.default_deposit_ratio,
    'deposit_usd',  round(v_total * v_settings.default_deposit_ratio, 2),
    -- Lo que costaría pagando en divisas. En bolívares no cambia nada.
    'igtf_enabled', coalesce(v_settings.igtf_enabled, false),
    'igtf_rate',    v_settings.igtf_rate,
    'igtf_usd',     v_igtf,
    'total_divisas_usd', v_total + v_igtf
  );
end;
$$

