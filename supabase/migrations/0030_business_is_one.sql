-- El negocio es uno. Las unidades cuelgan de él y ya.
--
-- El esquema arrancó con un nivel de más: `properties` como «alojamiento» y
-- `units` colgando de cada uno, previendo varias propiedades. Eso nunca llegó a
-- usarse y creó dos sitios para lo mismo:
--
--   properties.name          nunca se leyó — gana app_settings.business_name
--   properties.description   nunca se leyó
--   properties.city          sale en la portada y NO se podía editar
--   properties.address       respaldo de la dirección, tampoco editable
--
-- Que la ciudad apareciera en la web pública sin ninguna pantalla donde
-- cambiarla es el fallo concreto que esto cierra. Solo se podía tocar por SQL.
--
-- ## El modelo que queda
--
--   un negocio            app_settings, fila única, con su identidad y su
--                         configuración — y ahora también ciudad y dirección
--   una o varias unidades una habitación, una casa entera, un apartamento
--
-- Nada más. Sin nivel intermedio.
--
-- Si algún día hicieran falta varias propiedades —apartamentos en barrios
-- distintos— no se recupera esto: haría falta un modelo pensado, con su
-- dirección, su contenido y su mapa por propiedad. Dejar la tabla vacía «por si
-- acaso» solo mantiene viva la ambigüedad que causó el problema.

alter table app_settings
  add column if not exists business_city    text,
  add column if not exists business_address text;

comment on column app_settings.business_city is
  'Sale en la portada, debajo del titular. Editable en Ajustes → Negocio.';

comment on column app_settings.business_address is
  'Dirección del negocio. La sección «cómo llegar» puede sobreescribirla con la '
  'suya; esta es el respaldo.';

-- Se traen los valores antes de tirar nada.
update app_settings
   set business_city    = coalesce(business_city, p.city),
       business_address = coalesce(business_address, p.address)
  from (select city, address from properties order by created_at limit 1) p
 where app_settings.id;

-- ---------------------------------------------------------------------------
-- Las unidades dejan de colgar de una propiedad
-- ---------------------------------------------------------------------------

alter table units drop column if exists property_id;

drop table if exists properties;
