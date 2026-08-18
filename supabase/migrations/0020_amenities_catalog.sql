-- Catálogo de amenidades: lista de partida, categorías e iconos.
--
-- La tabla ya era dinámica, pero le faltaban las dos puntas: no había contenido
-- inicial —las diez que existían venían del script de datos de ejemplo— ni forma
-- de administrarlo desde el panel.
--
-- Se cargan por migración y no por sembrado porque son vocabulario del dominio,
-- no datos de prueba: una instalación limpia debe abrir con algo que marcar.

-- ---------------------------------------------------------------------------
-- Categoría y orden
-- ---------------------------------------------------------------------------

-- Con treinta amenidades, una lista plana de casillas deja de servir.
alter table amenities
  add column if not exists category text not null default 'otros',
  add column if not exists sort_order int not null default 0;

create index if not exists amenities_category_idx on amenities (category, sort_order);

comment on column amenities.icon is
  'Nombre del icono en lucide-react, p. ej. «Wifi». El código valida contra una '
  'lista conocida y cae en un punto neutro si no lo reconoce, así que un valor '
  'inventado no rompe la página.';

-- ---------------------------------------------------------------------------
-- Lista de partida
-- ---------------------------------------------------------------------------

-- `on conflict do nothing` la hace idempotente y respeta lo que ya exista:
-- reaplicarla no pisa etiquetas que el operador haya cambiado.
insert into amenities (slug, label, icon, category, sort_order) values
  -- Conectividad y entretenimiento
  ('wifi',            'WiFi',                  'Wifi',           'conectividad', 0),
  ('tv',              'TV por cable',          'Tv',             'conectividad', 1),
  ('escritorio',      'Escritorio de trabajo', 'Laptop',         'conectividad', 2),

  -- Climatización
  ('aire',            'Aire acondicionado',    'Snowflake',      'climatizacion', 0),
  ('ventilador',      'Ventilador',            'Fan',            'climatizacion', 1),
  ('agua-caliente',   'Agua caliente',         'ShowerHead',     'climatizacion', 2),

  -- Servicios del alojamiento
  ('desayuno',        'Desayuno incluido',     'Croissant',      'servicios', 0),
  ('limpieza-diaria', 'Limpieza diaria',       'Sparkles',       'servicios', 1),
  ('recepcion',       'Recepción 24 horas',    'Bell',           'servicios', 2),
  ('lavanderia',      'Lavandería',            'WashingMachine', 'servicios', 3),
  ('traslados',       'Traslados',             'BusFront',       'servicios', 4),
  ('gimnasio',        'Gimnasio',              'Dumbbell',       'servicios', 5),

  -- Cocina
  ('cocina',          'Cocina equipada',       'ChefHat',        'cocina', 0),
  ('nevera',          'Nevera',                'Refrigerator',   'cocina', 1),
  ('microondas',      'Microondas',            'Microwave',      'cocina', 2),
  ('cafetera',        'Cafetera',              'Coffee',         'cocina', 3),
  ('parrillera',      'Parrillera',            'Flame',          'cocina', 4),
  ('vajilla',         'Vajilla y cubertería',  'Utensils',       'cocina', 5),

  -- Exteriores
  ('piscina',         'Piscina',               'Waves',          'exteriores', 0),
  ('terraza',         'Terraza',               'Umbrella',       'exteriores', 1),
  ('jardin',          'Jardín',                'Trees',          'exteriores', 2),
  ('vista-mar',       'Vista al mar',          'Sunrise',        'exteriores', 3),
  ('vista-montana',   'Vista a la montaña',    'Mountain',       'exteriores', 4),
  ('playa-cerca',     'Playa a pocos pasos',   'Palmtree',       'exteriores', 5),
  ('brisa',           'Ventilación natural',   'Wind',           'exteriores', 6),

  -- Lo que en Venezuela decide una reserva
  ('planta',          'Planta eléctrica',      'Zap',            'servicios-basicos', 0),
  ('agua',            'Tanque de agua',        'Droplets',       'servicios-basicos', 1),
  ('estacionamiento', 'Estacionamiento',       'SquareParking',  'servicios-basicos', 2),
  ('caja-fuerte',     'Caja fuerte',           'Vault',          'servicios-basicos', 3),
  ('ropa-cama',       'Ropa de cama y toallas','BedDouble',      'servicios-basicos', 4),

  -- Normas
  ('mascotas',        'Admite mascotas',       'PawPrint',       'normas', 0),
  ('ninos',           'Apto para niños',       'Baby',           'normas', 1),
  ('accesible',       'Accesible en silla de ruedas', 'Accessibility', 'normas', 2),
  ('fumar',           'Permitido fumar',       'Cigarette',      'normas', 3)
on conflict (slug) do nothing;

-- Las que ya existían se quedaron en la categoría por defecto y sin icono.
update amenities a
   set category = v.category, sort_order = v.sort_order,
       icon = coalesce(nullif(a.icon, ''), v.icon)
  from (values
    ('wifi','Wifi','conectividad',0),
    ('tv','Tv','conectividad',1),
    ('aire','Snowflake','climatizacion',0),
    ('desayuno','Croissant','servicios',0),
    ('cocina','ChefHat','cocina',0),
    ('piscina','Waves','exteriores',0),
    ('vista-mar','Sunrise','exteriores',3),
    ('planta','Zap','servicios-basicos',0),
    ('agua','Droplets','servicios-basicos',1),
    ('estacionamiento','SquareParking','servicios-basicos',2)
  ) as v(slug, icon, category, sort_order)
 where a.slug = v.slug and a.category = 'otros';

-- ---------------------------------------------------------------------------
-- Borrado con aviso
-- ---------------------------------------------------------------------------

-- Borrar una amenidad la quita de todas las unidades en silencio, porque
-- unit_amenities cascadea. Igual que con las unidades que tienen reservas, se
-- avisa de cuántas la usan antes de dejar hacerlo.
create or replace function staff_delete_amenity(p_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_units int;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select count(*) into v_units from unit_amenities where amenity_id = p_id;

  if v_units > 0 and not p_force then
    return jsonb_build_object('ok', false, 'error', 'in_use', 'units', v_units);
  end if;

  delete from amenities where id = p_id;

  return jsonb_build_object('ok', true, 'units', v_units);
end;
$$;

revoke all on function staff_delete_amenity from public, anon;
grant execute on function staff_delete_amenity to authenticated;
