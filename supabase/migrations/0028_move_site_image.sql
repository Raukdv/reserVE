-- Mover una foto del sitio de una sección a otra.
--
-- Antes había una caja de subida por sección: tres cajas idénticas en la misma
-- página, y la única pista de cuál era cuál estaba en el título varios
-- centímetros más arriba. Equivocarse era lo normal — la foto acababa en
-- «Portada» creyendo que iba en «Sobre el negocio», y no había forma de
-- corregirlo salvo borrarla y volver a subirla.
--
-- Ahora hay una sola galería y cada foto lleva su destino encima. Esto es lo que
-- permite cambiarlo sin volver a subir el archivo.
--
-- Las fotos recién subidas entran como `sin_asignar`: una sección que la web
-- pública nunca consulta, así que existen en el panel sin verse en ningún lado
-- hasta que se les da destino. Subir un lote y repartirlo después es como se
-- trabaja de verdad.

create or replace function staff_move_site_image(p_id uuid, p_section text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_current text;
  v_order   int;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if coalesce(btrim(p_section), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_section');
  end if;

  select section_key into v_current from site_media where id = p_id;
  if v_current is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_current = p_section then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  -- Mismo bloqueo por sección que al añadir: sin él, dos movimientos a la vez
  -- hacia el mismo destino leerían el mismo máximo y repetirían el orden.
  perform pg_advisory_xact_lock(hashtext('site_media:' || p_section));

  select coalesce(max(sort_order) + 1, 0) into v_order
  from site_media where section_key = p_section;

  update site_media
     set section_key = p_section,
         sort_order  = v_order
   where id = p_id;

  return jsonb_build_object('ok', true, 'section', p_section, 'sort_order', v_order);
end;
$$;

revoke all on function staff_move_site_image from public, anon;
grant execute on function staff_move_site_image to authenticated;
