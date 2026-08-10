-- Almacén de fotos de las unidades.
--
-- A diferencia de los comprobantes, estas imágenes son públicas: las ve
-- cualquier visitante del catálogo. Un bucket público evita firmar una URL por
-- cada foto en cada visita, que sería trabajo de servidor repetido para servir
-- algo que no es secreto.
--
-- La subida sigue pasando por una acción de servidor con la clave de servicio:
-- sin políticas de inserción, nadie puede llenar el almacenamiento del plan
-- gratuito.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'unit-media', 'unit-media', true,
  600 * 1024,                      -- 600 KB; el servidor rechaza por encima de 400 KB
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Borrado de unidades
-- ---------------------------------------------------------------------------

-- Una unidad con reservas no se borra: perdería el historial de quién se alojó y
-- qué pagó. Se despublica, que la saca del catálogo sin romper nada.
create or replace function staff_delete_unit(p_unit_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_bookings int;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select count(*) into v_bookings from bookings where unit_id = p_unit_id;

  if v_bookings > 0 then
    return jsonb_build_object('ok', false, 'error', 'has_bookings', 'bookings', v_bookings);
  end if;

  delete from units where id = p_unit_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function staff_delete_unit from public, anon;
grant execute on function staff_delete_unit to authenticated;
