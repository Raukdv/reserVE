-- Retirar columnas de `properties` que nadie lee.
--
-- La tabla se creó con más campos de los que la app llegó a usar. Tres quedaron
-- prometiendo algo que no cumplían, que es el mismo problema que tuvieron
-- `BUSINESS_TIMEZONE` y `amenities.icon`: un dato que existe, se puede editar en
-- la base, y no cambia nada en pantalla.
--
--   latitude, longitude   el mapa se configura en Contenido → Cómo llegar
--   timezone              la zona vive en src/lib/timezone.ts y en business_today()
--
-- De toda la tabla, la aplicación solo consulta `id` y `city, address`.
--
-- ## Las coordenadas se mudan, no se tiran
--
-- Tenían datos buenos —los de la posada— y el mapa nuevo los necesita. Borrarlas
-- sin más obligaría al operador a buscarlos otra vez en Google Maps para
-- reescribir lo que ya estaba guardado.
--
-- Se copian a `site_content.location`, que es donde ahora se editan, y solo si
-- ahí no hay nada: si el operador ya escribió coordenadas a mano, mandan las
-- suyas.

do $$
declare
  v_lat numeric;
  v_lng numeric;
  v_current jsonb;
begin
  select latitude, longitude into v_lat, v_lng
  from properties order by created_at limit 1;

  if v_lat is null or v_lng is null then
    return;
  end if;

  select data into v_current from site_content where key = 'location';

  -- Ya hay coordenadas puestas a mano: no se pisan.
  if coalesce(v_current->>'lat', '') <> '' and coalesce(v_current->>'lng', '') <> '' then
    return;
  end if;

  insert into site_content (key, data)
  values (
    'location',
    coalesce(v_current, '{}'::jsonb) || jsonb_build_object('lat', v_lat, 'lng', v_lng)
  )
  on conflict (key) do update
    set data = coalesce(site_content.data, '{}'::jsonb)
               || jsonb_build_object('lat', v_lat, 'lng', v_lng),
        updated_at = now();
end $$;

alter table properties
  drop column if exists latitude,
  drop column if exists longitude,
  drop column if exists timezone;

comment on table properties is
  'El alojamiento como lugar físico. La app solo lee id, city y address; el resto '
  'del contenido público vive en site_content, que es lo que el operador edita.';
