-- Bloqueos manuales de fechas desde el panel.
--
-- Un bloqueo son dos filas —el hold que retiene las fechas y el motivo— y deben
-- entrar juntas: un hold sin su bloqueo es inventario perdido sin explicación, y
-- nadie sabría por qué esas noches no se venden.
--
-- Van como funciones SECURITY DEFINER para poder capturar la violación del
-- EXCLUDE y devolver un error legible en lugar de reventar la petición. Como
-- saltan RLS, comprueban el rol explícitamente.

create or replace function create_block(
  p_unit_id uuid,
  p_from    date,
  p_to      date,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_hold_id uuid;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_to <= p_from then
    return jsonb_build_object('ok', false, 'error', 'invalid_dates');
  end if;

  if not exists (select 1 from units where id = p_unit_id) then
    return jsonb_build_object('ok', false, 'error', 'unit_not_found');
  end if;

  begin
    insert into unit_holds (unit_id, stay, kind)
    values (p_unit_id, daterange(p_from, p_to, '[)'), 'block')
    returning id into v_hold_id;
  exception when exclusion_violation then
    -- Ya hay una reserva u otro bloqueo pisando ese rango.
    return jsonb_build_object('ok', false, 'error', 'occupied');
  end;

  insert into availability_blocks (hold_id, reason, created_by)
  values (v_hold_id, nullif(trim(p_reason), ''), auth.uid());

  return jsonb_build_object('ok', true, 'hold_id', v_hold_id);
end;
$$;

-- Liberar desactiva el hold en vez de borrarlo: conserva el historial de qué se
-- bloqueó y por qué, igual que con las reservas canceladas.
create or replace function release_block(p_hold_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_kind hold_kind;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select kind into v_kind from unit_holds where id = p_hold_id;

  if v_kind is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Una reserva se cancela por su propio flujo, no liberando el hold por debajo:
  -- quedaría la reserva viva sin fechas retenidas.
  if v_kind <> 'block' then
    return jsonb_build_object('ok', false, 'error', 'not_a_block');
  end if;

  update unit_holds set is_active = false where id = p_hold_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function create_block from public;
revoke all on function release_block from public;
grant execute on function create_block to authenticated;
grant execute on function release_block to authenticated;
