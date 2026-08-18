-- IGTF: Impuesto a las Grandes Transacciones Financieras.
--
-- La bandera `igtf_enabled` existía en ajustes desde el principio y no la leía
-- nadie: `quote_stay()` no la mencionaba y `bookings.igtf_ves` se quedaba en
-- cero. Era un interruptor que prometía cobrar un impuesto y no lo cobraba.
--
-- ## Por qué no funcionaba: lo grava el pago, no la estadía
--
-- El error de fondo era tratarlo como un impuesto de la reserva, como el IVA.
-- No lo es. El IGTF grava **el medio de pago**, así que la misma reserva lo
-- causa o no según cómo se cobre:
--
--   Pago Móvil, transferencia nacional, C2P  →  bolívares  →  0 %
--   Zelle, PayPal, Binance, USDT, efectivo   →  divisas    →  3 %
--
-- En el momento de cotizar todavía no se sabe cómo va a pagar el huésped, así
-- que ahí solo cabe una **proyección**. El importe real se determina al cobrar.
--
-- ## Qué dice la norma
--
-- - **3 % sobre pagos en divisas o criptoactivos** recibidos sin mediación del
--   sistema financiero nacional. Sigue vigente.
-- - **0 % en bolívares** desde el Decreto 4.972 (Gaceta 6.821 extraordinario,
--   12/07/2024, en vigor el 15/07/2024). Antes era 2 %.
-- - **Solo lo cobra quien está calificado como sujeto pasivo especial** por el
--   SENIAT. Quien no lo esté no puede cobrarlo aunque reciba divisas — por eso
--   el interruptor sigue apagado por defecto.
-- - **La base incluye los demás impuestos.** Si la factura es 100 + 16 de IVA,
--   el IGTF es el 3 % de 116. Aquí eso sale solo: se aplica sobre el total ya
--   compuesto por `compute_fees()`, que es donde viven los porcentajes.
-- - En la factura debe reflejarse el porcentaje aplicado, el monto en divisas y
--   su equivalente en bolívares.
--
-- ## Cómo se guarda
--
-- El huésped paga el total **más** el impuesto: es una percepción, la soporta
-- quien paga y el negocio la entera al fisco. Así que de lo que llega, una
-- parte no es suya.
--
--   amount       lo que se movió de verdad, en su moneda   (bruto)
--   igtf_usd     la parte que es impuesto                  (se entera al SENIAT)
--   amount_usd   lo que abona a la estadía                 (neto)
--
-- Guardar el neto en `amount_usd` es lo que mantiene correctas las ocho
-- funciones que calculan lo pagado con `sum(amount_usd)`: ninguna necesita
-- cambiar, y ninguna acredita a la reserva un dinero que no es del negocio.

alter table payments
  add column if not exists igtf_usd  numeric(12, 2) not null default 0,
  add column if not exists igtf_rate numeric(4, 3);

comment on column payments.igtf_usd is
  'Parte del pago que es IGTF. Ya descontada de amount_usd: el impuesto no abona '
  'la estadía porque no es del negocio.';

comment on column payments.igtf_rate is
  'Alícuota aplicada, congelada. Null cuando no se cobró IGTF.';

comment on column bookings.igtf_ves is
  'Sin uso. El IGTF depende del medio de pago, no de la reserva, así que vive en '
  'payments.igtf_usd. Se conserva la columna para no romper filas antiguas.';

-- ---------------------------------------------------------------------------
-- Cuánto IGTF lleva dentro un importe cobrado
-- ---------------------------------------------------------------------------

-- Devuelve la porción de impuesto contenida en un bruto ya cobrado.
--
-- Se extrae, no se añade: al huésped se le pidió el total con IGTF incluido y
-- eso es lo que reporta. Con alícuota r, el bruto es neto × (1 + r), así que el
-- impuesto es bruto × r / (1 + r) — y no bruto × r, que cobraría de más.
create or replace function igtf_in(p_currency text, p_gross numeric)
returns numeric
language plpgsql stable
as $$
declare
  v_settings app_settings%rowtype;
begin
  if p_gross is null or p_gross <= 0 then
    return 0;
  end if;

  select * into v_settings from app_settings;

  if not coalesce(v_settings.igtf_enabled, false) then
    return 0;
  end if;

  -- Los bolívares están al 0 % desde el Decreto 4.972.
  if p_currency <> 'USD' then
    return 0;
  end if;

  return round(p_gross * v_settings.igtf_rate / (1 + v_settings.igtf_rate), 2);
end;
$$;

-- ---------------------------------------------------------------------------
-- La cotización proyecta el impuesto, no lo suma al precio
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
$$;

-- ---------------------------------------------------------------------------
-- Los dos caminos de cobro separan el impuesto
-- ---------------------------------------------------------------------------

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
  v_gross_usd  numeric(12, 2);
  v_igtf       numeric(12, 2);
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

  if p_paid_at is not null and p_paid_at > now() + interval '1 day' then
    return jsonb_build_object('ok', false, 'error', 'future_date');
  end if;

  v_gross_usd := case
    when p_currency = 'USD' then round(p_amount, 2)
    else round(p_amount / v_booking.rate_snapshot, 2)
  end;

  if v_gross_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  v_igtf       := igtf_in(p_currency, v_gross_usd);
  v_amount_usd := v_gross_usd - v_igtf;

  if v_amount_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  v_kind := case when v_paid > 0 then 'balance' else 'deposit' end;

  insert into payments (
    booking_id, kind, method, status, currency, amount, amount_usd, rate_used,
    igtf_usd, igtf_rate,
    origin, reference, paid_at, receipt_path, payer_name, payer_document
  ) values (
    v_booking.id, v_kind, p_method, 'verifying', p_currency, p_amount, v_amount_usd,
    case when p_currency = 'VES' then v_booking.rate_snapshot else null end,
    v_igtf, case when v_igtf > 0 then (select igtf_rate from app_settings) else null end,
    nullif(trim(p_origin), ''), nullif(trim(p_reference), ''),
    p_paid_at, p_receipt_path,
    nullif(trim(p_payer_name), ''), nullif(trim(p_payer_document), '')
  );

  update bookings
     set expires_at = greatest(coalesce(expires_at, now()), now() + interval '72 hours'),
         updated_at = now()
   where id = v_booking.id and status = 'pending';

  return jsonb_build_object(
    'ok', true, 'amount_usd', v_amount_usd, 'igtf_usd', v_igtf
  );
end;
$$;

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
  v_booking    bookings%rowtype;
  v_staff      uuid := auth.uid();
  v_gross_usd  numeric(12, 2);
  v_igtf       numeric(12, 2);
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

  v_gross_usd := case
    when p_currency = 'USD' then round(p_amount, 2)
    else round(p_amount / v_booking.rate_snapshot, 2)
  end;

  v_igtf       := igtf_in(p_currency, v_gross_usd);
  v_amount_usd := v_gross_usd - v_igtf;

  if v_amount_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  v_kind := case when v_paid > 0 then 'balance' else 'deposit' end;

  insert into payments (
    booking_id, kind, method, status, currency, amount, amount_usd, rate_used,
    igtf_usd, igtf_rate,
    reference, paid_at, admin_notes, reviewed_by, reviewed_at
  ) values (
    v_booking.id, v_kind, p_method, 'approved', p_currency, p_amount, v_amount_usd,
    case when p_currency = 'VES' then v_booking.rate_snapshot else null end,
    v_igtf, case when v_igtf > 0 then (select igtf_rate from app_settings) else null end,
    nullif(trim(p_reference), ''), now(), nullif(trim(p_notes), ''),
    v_staff, now()
  );

  v_settled := settle_booking(v_booking.id);

  return jsonb_build_object(
    'ok', true,
    'amount_usd', v_amount_usd,
    'igtf_usd', v_igtf,
    'confirmed', coalesce((v_settled->>'confirmed')::boolean, false),
    'paid_usd', (v_settled->>'paid_usd')::numeric
  );
end;
$$;

revoke all on function igtf_in from public;
grant execute on function igtf_in to anon, authenticated;
