-- La portada de cada unidad, una fila por unidad.
--
-- El catálogo necesita una sola foto por alojamiento. Pedirlas todas y quedarse
-- con la primera en el servidor de Next obliga a traer cada foto de cada unidad
-- —decenas de filas para pintar una miniatura— y a poner un tope que, al
-- ordenar por unidad, dejaría sin portada justo a las últimas de la lista.
--
-- `distinct on` lo resuelve en la base: recorre el índice (unit_id, sort_order)
-- que ya existe y devuelve exactamente una fila por unidad.
--
-- La portada es la foto de menor `sort_order` y no la de `sort_order = 0`:
-- borrar la primera no renumera al resto, así que el cero puede no existir.

create or replace view unit_covers
  with (security_invoker = on)
  as
select distinct on (unit_id)
       unit_id,
       storage_path,
       alt_text
  from unit_media
 order by unit_id, sort_order, created_at;

comment on view unit_covers is
  'Foto de portada por unidad: la de menor sort_order. security_invoker deja '
  'que las políticas de unit_media sigan aplicando en lugar de las del dueño.';

grant select on unit_covers to anon, authenticated;
