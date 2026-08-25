# Amenidades

Qué ofrece cada unidad —wifi, aire, piscina, no se admiten mascotas— y por qué es
un catálogo compartido en lugar de una lista libre por unidad.

---

## Catálogo compartido, no texto por unidad

Dos tablas y nada más:

```
amenities        id, slug, label, icon, category, sort_order
unit_amenities   unit_id, amenity_id        ← clave primaria compuesta
```

La alternativa era un campo de texto en cada unidad. Se descartó por lo de
siempre con el texto libre: la misma cosa acaba escrita de cinco maneras —«Wifi»,
«WiFi», «Internet», «wi-fi», «Wifi gratis»— y entonces no se puede filtrar, ni
agrupar, ni poner un icono, ni traducir. Un catálogo obliga a elegir de una
lista, que es exactamente lo que hace falta.

`unit_amenities` es solo la unión: primaria compuesta `(unit_id, amenity_id)`, y
`on delete cascade` por los dos lados. Borrar una unidad se lleva sus enlaces;
borrar una amenidad, también.

---

## El icono se guarda por nombre, y se valida contra un mapa

La base guarda `icon = 'Wifi'`, una cadena. `src/lib/amenities.ts` la resuelve
contra un mapa de 34 iconos de Lucide.

Un mapa explícito y no un import dinámico, por dos razones:

- **Un valor inventado en la base no debe romper la página.** Si alguien escribe
  `icon = 'Cohete'`, el mapa devuelve nada y la amenidad sale sin icono. Con un
  import dinámico sería un error en tiempo de ejecución en la ficha pública.
- **El empaquetado necesita saber qué se usa.** Un import dinámico obliga a
  incluir la librería entera; el mapa deja fuera lo que no está.

El selector del panel se alimenta del mismo mapa, así que no se puede elegir un
icono que no exista.

---

## Las categorías ordenan la ficha

Ocho, en orden fijo:

```
conectividad · climatizacion · servicios · cocina
exteriores · servicios-basicos · normas · otros
```

`otros` va al final y recoge lo que el operador cree sin encasillar. Existe
porque obligar a clasificar cada cosa nueva es fricción sin ganancia: si no
encaja, cae ahí y la ficha sigue leyéndose bien.

El orden es de presentación, no alfabético. Primero lo que la gente busca antes
de reservar —wifi, aire— y al final las normas, que se leen cuando ya se decidió.

Las categorías viven en la app, no en la base. Son ocho cadenas que solo la
interfaz usa para agrupar; una tabla de categorías sería un join por cada ficha
para no aprender nada.

---

## Borrar una amenidad en uso avisa antes

`staff_delete_amenity()` cuenta primero:

```sql
select count(*) into v_units from unit_amenities where amenity_id = p_id;
if v_units > 0 and not p_force then
  return jsonb_build_object('ok', false, 'error', 'in_use', 'units', v_units);
```

El `on delete cascade` haría el borrado en silencio y quitaría «wifi» de seis
unidades sin que nadie se enterara hasta ver la ficha pública. El conteo
convierte eso en una pregunta: *«esto está en 6 unidades, ¿seguro?»*.

`p_force` es el sí. La cascada sigue haciendo el trabajo; lo que se añadió es el
aviso.

---

## Qué trae de fábrica

La migración `0020` siembra 34 amenidades repartidas en siete categorías. No es
decoración: sin catálogo de partida, la primera unidad se publica sin ninguna
amenidad porque crearlas una a una antes de poder marcarlas es demasiado trabajo
para el primer día.

El operador puede añadir, editar y borrar. El catálogo sembrado es un punto de
partida, no una lista cerrada.

---

## Lo que no cubre

**No se filtra por amenidad.** El catálogo permite hacerlo —es media razón de que
exista— pero el buscador público no lo ofrece. Con un puñado de unidades no
aporta.

**No hay amenidades con valor.** «Wifi» es sí o no; no se puede decir «wifi de
50 Mbps» ni «piscina climatizada». Lo que hay es una marca, no un dato.

**El `slug` no se usa para nada todavía.** Es único y está pensado para
identificar la amenidad de forma estable —traducciones, filtros por URL— pero hoy
la aplicación lee `label` e `icon`.

**El orden dentro de una categoría depende de `sort_order`**, que se edita a
mano. No hay arrastre.

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Tablas y catálogo sembrado | `amenities`, `unit_amenities`, migración `0020` |
| Borrado con aviso | `staff_delete_amenity()` |
| Iconos y categorías | `src/lib/amenities.ts` |
| Panel | `/admin/amenidades` |
| Marcar por unidad | `/admin/unidades/[id]` |
| Ficha pública | `/alojamientos/[slug]` |
