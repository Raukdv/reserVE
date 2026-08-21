-- Marcar un no-show.
--
-- El estado entró en la `0031`; aquí llega lo que lo escribe.
--
-- ## Por qué no es una cancelación
--
-- Consultado con operadores: al que no aparece **no se le devuelve nada**. Una
-- cancelación pasa por `cancellation_quote()` y devolvería lo que marque el
-- tramo vigente — con una política moderada, eso es el 100 % a alguien que
-- dejó la habitación vacía sin avisar.
--
-- Así que `refund_due_usd` se fija en cero explícitamente, y no se calcula. Es
-- la diferencia entre las dos salidas, y tiene que estar escrita en la fila:
-- dentro de seis meses nadie recordará por qué esa reserva no generó deuda.
--
-- Lo cobrado **no se toca**. Sigue en `payments` como lo que fue: dinero que
-- entró y se quedó. Devolverlo por acuerdo posterior sigue siendo posible con
-- `staff_record_refund()`, que es el camino para lo que se decide caso a caso.
--
-- ## Solo desde `confirmed`
--
-- Un no-show es, por definición, alguien que nunca llegó. Si está `checked_in`
-- es que llegó, y lo que falta entonces es marcar la salida. Si sigue
-- `pending`, la reserva expira sola y nadie retuvo nada porque no había pago.

create or replace function staff_mark_no_show(p_code text, p_reason text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_paid    numeric(12, 2);
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_booking.status <> 'confirmed' then
    return jsonb_build_object(
      'ok', false, 'error', 'not_confirmed', 'status', v_booking.status
    );
  end if;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  update bookings
     set status         = 'no_show',
         cancelled_at   = now(),
         cancel_reason  = coalesce(nullif(trim(p_reason), ''), 'No se presentó'),
         -- Cero, no null: null significaría «sin calcular» y esto es una
         -- decisión tomada, no un hueco.
         refund_due_usd = 0,
         expires_at     = null,
         updated_at     = now()
   where id = v_booking.id;

  -- Las fechas se liberan igual que en una cancelación: la habitación quedó
  -- vacía y no tiene sentido seguir reteniéndola.
  update unit_holds set is_active = false where id = v_booking.hold_id;

  return jsonb_build_object('ok', true, 'retained_usd', v_paid);
end;
$$;

revoke all on function staff_mark_no_show from public, anon;
grant execute on function staff_mark_no_show to authenticated;
