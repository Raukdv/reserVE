-- Marcar entrada y salida.
--
-- Completa la máquina de estados: confirmed → checked_in → completed.
--
-- La salida comprueba el saldo. Cerrar una estadía con dinero pendiente es cómo
-- se pierde el cobro: el huésped se va, la reserva queda «completada» y nadie
-- vuelve a mirarla. Se puede forzar —a veces se acuerda cobrar después— pero
-- tiene que ser una decisión consciente, no un descuido.

alter table bookings
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_out_at timestamptz;

create or replace function staff_check_in(p_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking bookings%rowtype;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_booking.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'not_confirmed', 'status', v_booking.status);
  end if;

  update bookings
     set status = 'checked_in', checked_in_at = now(), updated_at = now()
   where id = v_booking.id;

  -- Se avisa si entra antes de tiempo, pero no se impide: el operador sabe
  -- mejor que la app si la habitación está lista.
  return jsonb_build_object(
    'ok', true,
    'early', v_booking.check_in > business_today()
  );
end;
$$;

create or replace function staff_check_out(p_code text, p_force boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_paid    numeric(12, 2);
  v_due     numeric(12, 2);
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_booking.status <> 'checked_in' then
    return jsonb_build_object('ok', false, 'error', 'not_checked_in', 'status', v_booking.status);
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  v_due := round(v_booking.total_usd - v_paid, 2);

  if v_due > 0.01 and not p_force then
    return jsonb_build_object('ok', false, 'error', 'balance_due', 'due_usd', v_due);
  end if;

  update bookings
     set status = 'completed', checked_out_at = now(), updated_at = now()
   where id = v_booking.id;

  return jsonb_build_object('ok', true, 'due_usd', greatest(v_due, 0));
end;
$$;

revoke all on function staff_check_in from public, anon;
revoke all on function staff_check_out from public, anon;
grant execute on function staff_check_in to authenticated;
grant execute on function staff_check_out to authenticated;
