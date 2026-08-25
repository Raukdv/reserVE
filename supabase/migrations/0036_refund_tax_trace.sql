-- Dejar por escrito cuánto de cada devolución fue impuesto.
--
-- ## Por qué hace falta
--
-- Devolver el IVA al huésped y recuperarlo del SENIAT son dos operaciones
-- distintas. La segunda exige una **nota de crédito** que anule la factura
-- original, y este sistema no emite facturas — así que hoy el IVA devuelto sale
-- del bolsillo del negocio y no vuelve.
--
-- Eso no se arregla aquí; necesita facturación autorizada. Lo que sí se puede
-- hacer ya es **no perder el dato**: registrar cuánto de cada devolución fue
-- impuesto, para que el día que exista libro de ventas las devoluciones
-- anteriores se puedan reconstruir. Un número que no se guarda en el momento no
-- se recupera después.
--
-- ## Lo que NO cambia
--
-- El cálculo del reembolso queda **exactamente igual**. Hay una consulta abierta
-- sobre si la penalización de cancelación y el no-show son base imponible del
-- IVA o indemnización no gravada —ver `docs/PENDIENTES.md`—, y hasta que un
-- contador la responda no se toca lo que se devuelve. Esto solo mide y expone.

alter table payments
  add column if not exists tax_usd numeric(12, 2);

comment on column payments.tax_usd is
  'Parte de este movimiento que corresponde a impuestos del desglose (IVA y '
  'similares). Informativo: no participa de ninguna suma de cobro. En las '
  'devoluciones se calcula en proporción al total de la reserva.';

-- ---------------------------------------------------------------------------
-- La cotización de cancelación separa el impuesto
-- ---------------------------------------------------------------------------

-- Mismo cálculo, un campo más. `fees_refunded_usd` mezclaba los cargos de monto
-- con los porcentajes, así que el operador veía «cargos devueltos: 19,20» sin
-- saber que los 19,20 eran íntegramente IVA. Con la consulta del contador
-- abierta, esa cifra es justo la que hay que poder mirar.
create or replace function cancellation_quote(p_code text)
returns jsonb
language plpgsql
stable security definer set search_path = public
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
  v_tax_back  numeric(12, 2) := 0;
  v_tax_total numeric(12, 2) := 0;
  v_base      numeric(12, 2) := 0;
  v_entitled  numeric(12, 2) := 0;
  v_refunded  int := 0;
  v_share     numeric(12, 2);
begin
  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_settings from app_settings;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  -- Cuánto impuesto lleva la reserva en total. Se usa para saber qué parte se
  -- queda sin devolver, que es el número de la consulta pendiente.
  for v_fee in select value from jsonb_array_elements(v_booking.fees_breakdown)
  loop
    if coalesce((v_fee->>'is_tax')::boolean, false) then
      v_tax_total := v_tax_total + (v_fee->>'amount_usd')::numeric;
    end if;
  end loop;

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
      'fees_refunded_usd', 0, 'check_in_at', v_deadline,
      'tax_total_usd', v_tax_total, 'tax_refunded_usd', 0,
      'tax_retained_usd', v_tax_total
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
      'check_in_at', v_deadline,
      'tax_total_usd', v_tax_total, 'tax_refunded_usd', v_tax_total,
      'tax_retained_usd', 0
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
      v_share := case
        when v_booking.subtotal_usd > 0
          then round((v_fee->>'amount_usd')::numeric * v_nights_kept / v_booking.subtotal_usd, 2)
        else 0 end;
      v_fees_back := v_fees_back + v_share;
      if coalesce((v_fee->>'is_tax')::boolean, false) then
        v_tax_back := v_tax_back + v_share;
      end if;
    end if;
  end loop;

  -- Base reembolsable: noches conservadas más cargos que las acompañan.
  v_base := v_nights_kept + v_fees_back;

  -- Los porcentajes siguen a su base.
  for v_fee in select value from jsonb_array_elements(v_booking.fees_breakdown)
  loop
    if v_fee->>'kind' = 'percent' and coalesce((v_fee->>'base_usd')::numeric, 0) > 0 then
      v_share := round(
        (v_fee->>'amount_usd')::numeric * v_base / (v_fee->>'base_usd')::numeric, 2);
      v_pct_fees := v_pct_fees + v_share;
      if coalesce((v_fee->>'is_tax')::boolean, false) then
        v_tax_back := v_tax_back + v_share;
      end if;
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
    'check_in_at',       v_deadline,
    -- Impuesto: cuánto llevaba, cuánto vuelve y cuánto se queda retenido.
    --
    -- `tax_retained_usd` es el número de la consulta abierta. Si la penalización
    -- resulta ser indemnización no gravada, esta cifra debería ser siempre cero
    -- y el huésped recibir el impuesto íntegro. Hoy no lo es, a propósito: no se
    -- cambia el cálculo del dinero sobre una lectura sin confirmar.
    'tax_total_usd',     v_tax_total,
    'tax_refunded_usd',  round(v_tax_back, 2),
    'tax_retained_usd',  round(v_tax_total - v_tax_back, 2)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- La devolución anota su impuesto y avisa si el servicio ya se prestó
-- ---------------------------------------------------------------------------

create or replace function staff_record_refund(
  p_code      text,
  p_method    payment_method,
  p_currency  text,
  p_amount    numeric,
  p_reference text default null,
  p_paid_at   timestamptz default null,
  p_notes     text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking   bookings%rowtype;
  v_usd       numeric(12, 2);
  v_paid      numeric(12, 2);
  v_refunded  numeric(12, 2);
  v_fee       jsonb;
  v_tax_total numeric(12, 2) := 0;
  v_tax       numeric(12, 2) := 0;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
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

  -- Misma tasa congelada con la que se cobró. Devolver a la tasa de hoy
  -- cambiaría el importe en dólares de una operación ya cerrada.
  v_usd := case
    when p_currency = 'USD' then round(p_amount, 2)
    else round(p_amount / v_booking.rate_snapshot, 2)
  end;

  if v_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  select coalesce(sum(amount_usd), 0) into v_refunded
  from payments
  where booking_id = v_booking.id and kind = 'refund' and status = 'refunded';

  -- La invariante dura: no se puede devolver más de lo que llegó a entrar.
  -- Lo que la política obligue es otra cosa; el tope lo pone la caja.
  if v_refunded + v_usd > v_paid + 0.01 then
    return jsonb_build_object(
      'ok', false, 'error', 'exceeds_paid',
      'paid_usd', v_paid, 'refunded_usd', v_refunded,
      'available_usd', greatest(v_paid - v_refunded, 0)
    );
  end if;

  /*
    Cuánto de esta devolución era impuesto.

    En proporción al total de la reserva, porque el importe lo teclea el
    operador y no tiene por qué corresponder a un tramo de la política: una
    devolución puede ser un acuerdo puntual, o el segundo de dos pagos.
    Repartir proporcionalmente es lo que haría cualquiera con el recibo delante.

    Es informativo y no participa de ninguna suma de cobro. Está para que el día
    que haya libro de ventas —que exige nota de crédito, ver `PENDIENTES.md`—
    las devoluciones anteriores se puedan reconstruir. Un número que no se anota
    en el momento no se recupera después.
  */
  for v_fee in select value from jsonb_array_elements(v_booking.fees_breakdown)
  loop
    if coalesce((v_fee->>'is_tax')::boolean, false) then
      v_tax_total := v_tax_total + (v_fee->>'amount_usd')::numeric;
    end if;
  end loop;

  if v_tax_total > 0 and v_booking.total_usd > 0 then
    v_tax := round(v_usd * v_tax_total / v_booking.total_usd, 2);
  end if;

  insert into payments (
    booking_id, kind, method, status, currency, amount, amount_usd, rate_used,
    reference, paid_at, admin_notes, reviewed_by, reviewed_at, tax_usd
  ) values (
    v_booking.id, 'refund'::payment_kind, p_method, 'refunded'::payment_status,
    p_currency, p_amount, v_usd,
    case when p_currency = 'VES' then v_booking.rate_snapshot else null end,
    nullif(trim(p_reference), ''), coalesce(p_paid_at, now()),
    nullif(trim(p_notes), ''), auth.uid(), now(), nullif(v_tax, 0)
  );

  v_refunded := v_refunded + v_usd;

  return jsonb_build_object(
    'ok',              true,
    'amount_usd',      v_usd,
    'refunded_usd',    v_refunded,
    'due_usd',         v_booking.refund_due_usd,
    -- Lo que falta según la política. Null si la reserva no se canceló: una
    -- devolución puede hacerse por acuerdo sin que haya obligación calculada.
    'pending_usd',     case
                         when v_booking.refund_due_usd is null then null
                         else greatest(round(v_booking.refund_due_usd - v_refunded, 2), 0)
                       end,
    'available_usd',   greatest(round(v_paid - v_refunded, 2), 0),
    'tax_usd',         v_tax,
    -- Aviso, no bloqueo. Si el huésped se alojó, el hecho imponible ocurrió y
    -- el IVA no se recupera: en Venezuela no hay devolución de impuesto al
    -- turista. Devolver dinero sigue siendo decisión del operador —un acuerdo,
    -- una queja— pero conviene que sepa que ese tramo se paga entero.
    'service_rendered', v_booking.status in ('checked_in', 'completed')
  );
end;
$$;

revoke all on function staff_record_refund from public, anon;
grant execute on function staff_record_refund to authenticated;
