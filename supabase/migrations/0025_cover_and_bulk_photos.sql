-- Elegir la portada, y subir fotos sin carreras.
--
-- ## La portada se elige, no se hereda del orden
--
-- Hasta ahora la portada era «la primera de la lista», así que cambiarla exigía
-- mover la imagen con flechas hasta el principio: una forma indirecta de decir
-- «quiero esta». Peor aún, mezclaba dos decisiones —cuál es la cara del
-- alojamiento y en qué orden se ven las demás— en un solo control.
--
-- Ahora hay una marca explícita. El orden sigue sirviendo para la galería.
--
-- **Qué pasa al borrar la marcada**: la portada vuelve a ser la de menor
-- `sort_order`, sin dejar la unidad sin cara ni obligar a elegir otra. La vista
-- lo resuelve ordenando por la marca primero y por el orden después, así que el
-- comportamiento anterior queda como red de seguridad.
--
-- ## El `sort_order` se calculaba con una carrera dentro
--
-- La acción de servidor leía el máximo y después insertaba. Entre las dos
-- consultas cabe otra subida, y con la selección múltiple eso deja de ser
-- teórico: dos fotos con el mismo número y un orden que depende del azar.
--
-- Lo mismo con el tope de cuarenta: dos subidas simultáneas podían leer 39 las
-- dos y acabar en 41. Ambas comprobaciones bajan aquí, a una sola sentencia.

alter table unit_media
  add column if not exists is_cover boolean not null default false;

comment on column unit_media.is_cover is
  'Portada elegida a mano. Sin ninguna marcada, la portada es la de menor '
  'sort_order — ver la vista unit_covers.';

-- Una sola portada por unidad, garantizado por la base y no por el código.
create unique index if not exists unit_media_one_cover
  on unit_media (unit_id) where is_cover;

-- La marca manda; el orden es el desempate.
create or replace view unit_covers
  with (security_invoker = on)
  as
select distinct on (unit_id)
       unit_id,
       storage_path,
       alt_text
  from unit_media
 order by unit_id, is_cover desc, sort_order, created_at;

comment on view unit_covers is
  'Foto de portada por unidad: la marcada, o la de menor sort_order si no hay '
  'ninguna. security_invoker deja que las políticas de unit_media sigan '
  'aplicando en lugar de las del dueño.';

-- ---------------------------------------------------------------------------
-- Marcar la portada
-- ---------------------------------------------------------------------------

create or replace function staff_set_cover(p_media_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_unit uuid;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select unit_id into v_unit from unit_media where id = p_media_id;
  if v_unit is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Se limpia antes de marcar: el índice único solo admite una por unidad, y
  -- hacerlo al revés lo violaría a mitad de la operación.
  update unit_media set is_cover = false where unit_id = v_unit and is_cover;
  update unit_media set is_cover = true  where id = p_media_id;

  return jsonb_build_object('ok', true, 'unit_id', v_unit);
end;
$$;

-- ---------------------------------------------------------------------------
-- Añadir una foto, con el tope y el orden resueltos de una vez
-- ---------------------------------------------------------------------------

create or replace function staff_add_photo(
  p_unit_id uuid,
  p_path    text,
  p_max     int default 40
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_lock  uuid;
  v_count int;
  v_id    uuid;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Se bloquea la fila de la unidad, no las fotos: `for update` no admite
  -- agregados, y además con cero fotos no habría nada que bloquear. Esto
  -- serializa las subidas de una misma unidad, que es justo lo que hace falta
  -- para que el tope y el sort_order no se calculen sobre datos rancios.
  select id into v_lock from units where id = p_unit_id for update;

  if v_lock is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select count(*) into v_count from unit_media where unit_id = p_unit_id;

  if v_count >= p_max then
    return jsonb_build_object('ok', false, 'error', 'too_many', 'max', p_max);
  end if;

  insert into unit_media (unit_id, storage_path, sort_order)
  select p_unit_id, p_path, coalesce(max(sort_order) + 1, 0)
  from unit_media where unit_id = p_unit_id
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'count', v_count + 1);
end;
$$;

revoke all on function staff_set_cover from public, anon;
revoke all on function staff_add_photo from public, anon;
grant execute on function staff_set_cover to authenticated;
grant execute on function staff_add_photo to authenticated;
