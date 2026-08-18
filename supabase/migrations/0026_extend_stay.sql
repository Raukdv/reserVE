-- Alargar una estadía.
--
-- Hasta ahora, un huésped que se quedaba una noche más no tenía salida: había
-- que crear otra reserva, y el `EXCLUDE` la rechazaba si esa noche ya estaba
-- tomada por él mismo. Quedaba resolverlo a mano en la base.
--
-- ## Qué se recalcula y qué no
--
-- La regla es que **alargar no repacta lo ya acordado**. Las noches que el
-- huésped ya tenía conservan su precio, y los cargos conservan los suyos aunque
-- la tabla `fees` haya cambiado desde entonces. Solo se suma lo nuevo:
--
--   noches nuevas   a su precio real, con `night_price()` — temporada incluida
--   cargo `fixed`   igual: es por estadía, no por noche
--   `per_guest`     igual: los huéspedes no cambian
--   `per_night`     escala a las noches nuevas, con la tarifa congelada
--   `percent`       se recalcula sobre la base nueva, con el tipo congelado
--
-- Recalcular todo con `compute_fees()` habría sido más corto, pero aplicaría las
-- tarifas de hoy a una estadía pactada ayer.
--
-- La tasa **no** se toca: sigue siendo `rate_snapshot`. Alargar no es
-- renegociar el cambio.
--
-- ## Acortar no está aquí
--
-- Solo se alarga. Recortar una estadía es otra operación: implica devolver
-- dinero y pasa por la política de cancelación, no por esto.

create or replace function staff_extend_stay(p_code text, p_check_out date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking   bookings%rowtype;
  v_extra     int;
  v_added     numeric(12, 2) := 0;
  v_subtotal  numeric(12, 2);
  v_nights    int;
  v_item      jsonb;
  v_amount    numeric(12, 2);
  v_items     jsonb := '[]'::jsonb;
  v_base      numeric(12, 2);
  v_fees      numeric(12, 2) := 0;
  v_total     numeric(12, 2);
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Alargar una pendiente no tiene sentido: todavía puede expirar. Y una
  -- cerrada ya no admite cambios.
  if v_booking.status not in ('confirmed', 'checked_in') then
    return jsonb_build_object('ok', false, 'error', 'not_extendable', 'status', v_booking.status);
  end if;

  v_extra := p_check_out - v_booking.check_out;
  if v_extra <= 0 then
    return jsonb_build_object('ok', false, 'error', 'not_later');
  end if;

  -- Precio de las noches que se añaden, cada una a la suya.
  select coalesce(sum(night_price(v_booking.unit_id, n::date)), 0) into v_added
  from generate_series(v_booking.check_out, p_check_out - 1, '1 day') n;

  v_nights   := v_booking.nights + v_extra;
  v_subtotal := v_booking.subtotal_usd + v_added;

  -- Cargos: se conservan los pactados y solo escala lo que depende de noches.
  v_base := v_subtotal;

  for v_item in select * from jsonb_array_elements(v_booking.fees_breakdown)
  loop
    if v_item->>'kind' <> 'percent' then
      v_amount := case v_item->>'kind'
        when 'per_night' then round((v_item->>'rate')::numeric * v_nights, 2)
        else (v_item->>'amount_usd')::numeric
      end;

      v_base  := v_base + v_amount;
      v_fees  := v_fees + v_amount;
      v_items := v_items || (v_item || jsonb_build_object('amount_usd', v_amount));
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(v_booking.fees_breakdown)
  loop
    if v_item->>'kind' = 'percent' then
      v_amount := round(v_base * (v_item->>'rate')::numeric / 100.0, 2);
      v_fees   := v_fees + v_amount;
      v_items  := v_items || (v_item || jsonb_build_object(
        'amount_usd', v_amount, 'base_usd', v_base));
    end if;
  end loop;

  v_total := v_subtotal + v_fees;

  -- Mover el rango es lo que decide si se puede: si las noches nuevas están
  -- tomadas, el EXCLUDE lo rechaza aquí y no hay nada que deshacer.
  begin
    update unit_holds
       set stay = daterange(v_booking.check_in, p_check_out, '[)')
     where id = v_booking.hold_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end;

  -- `nights` es columna generada a partir de las fechas: se recalcula sola al
  -- mover `check_out`, y asignarla aquí sería un error.
  update bookings
     set check_out      = p_check_out,
         subtotal_usd   = v_subtotal,
         fees_usd       = v_fees,
         fees_breakdown = v_items,
         total_usd      = v_total,
         total_ves      = round(v_total * v_booking.rate_snapshot, 2),
         updated_at     = now()
   where id = v_booking.id;

  return jsonb_build_object(
    'ok',            true,
    'extra_nights',  v_extra,
    'added_usd',     round(v_total - v_booking.total_usd, 2),
    'nights',        v_nights,
    'total_usd',     v_total
  );
end;
$$;

revoke all on function staff_extend_stay from public, anon;
grant execute on function staff_extend_stay to authenticated;
