-- Fotos del negocio, no de una unidad.
--
-- Las secciones del home —«sobre nosotros», «cómo llegar»— pintaban un
-- degradado de marcador que no había forma de sustituir: las fotos solo existían
-- para unidades, colgando de `unit_media`, y esas secciones no son unidades.
-- Quedaba un rectángulo de color esperando algo que nunca podía llegar.
--
-- El modelo que faltaba es el que separa los dos niveles:
--
--   el sitio     representa al negocio      → la casa, la terraza, el entorno
--   las unidades son su inventario          → cada habitación o apartamento
--
-- Una foto del patio no pertenece a ninguna habitación, y una posada con quince
-- habitaciones sigue teniendo un solo patio.
--
-- Se calca la forma de `unit_media` a propósito: mismo orden por `sort_order`,
-- mismo texto alternativo, misma manera de contar el tope y asignar el orden en
-- una sola sentencia. Dos tablas que hacen lo mismo deben parecerse.

create table if not exists site_media (
  id           uuid primary key default gen_random_uuid(),

  -- A qué sección pertenece. Misma clave que en `site_content`, para que
  -- editar el texto y las fotos de una sección se sienta como una sola cosa.
  section_key  text not null,

  storage_path text not null,
  alt_text     text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists site_media_section_idx
  on site_media (section_key, sort_order);

comment on table site_media is
  'Fotos que representan al negocio, no a una unidad. Agrupadas por la misma '
  'clave de sección que usa site_content.';

alter table site_media enable row level security;

-- Públicas de leer, como las de unidades: se ven en la web sin sesión.
create policy site_media_read on site_media for select using (true);
create policy site_media_write on site_media for all
  using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Almacén
-- ---------------------------------------------------------------------------

-- Bucket propio y no un prefijo dentro de `unit-media`: el nombre de ese bucket
-- dice de qué son sus archivos, y meter ahí fotos que no son de ninguna unidad
-- lo convertiría en mentira. Mismos límites, que salen de la misma aritmética
-- de egreso — ver COSTO-CERO.md.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-media', 'site-media', true,
  600 * 1024,                      -- 600 KB; el servidor rechaza por encima de 400 KB
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Añadir una foto con el tope y el orden resueltos de una vez
-- ---------------------------------------------------------------------------

create or replace function staff_add_site_image(
  p_section text,
  p_path    text,
  p_max     int default 12
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_count int;
  v_id    uuid;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if coalesce(btrim(p_section), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Se serializa por sección con un bloqueo de aviso: aquí no hay fila padre que
  -- bloquear —las secciones son claves de texto, no registros— y sin esto dos
  -- subidas a la vez leerían el mismo máximo y repetirían el `sort_order`.
  perform pg_advisory_xact_lock(hashtext('site_media:' || p_section));

  select count(*) into v_count from site_media where section_key = p_section;

  if v_count >= p_max then
    return jsonb_build_object('ok', false, 'error', 'too_many', 'max', p_max);
  end if;

  insert into site_media (section_key, storage_path, sort_order)
  select p_section, p_path, coalesce(max(sort_order) + 1, 0)
  from site_media where section_key = p_section
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'count', v_count + 1);
end;
$$;

revoke all on function staff_add_site_image from public, anon;
grant execute on function staff_add_site_image to authenticated;
