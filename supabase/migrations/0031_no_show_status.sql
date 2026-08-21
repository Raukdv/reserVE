-- Estado para el huésped que no se presenta.
--
-- Consultado con operadores: **no se le devuelve nada**. Por eso no basta con
-- cancelar, que calcula el reembolso con la política y devolvería lo que marque
-- el tramo vigente. Son dos hechos distintos y hasta ahora compartían salida:
--
--   cancelar   alguien avisó y se aplica la política
--   no-show    no apareció y no avisó; se retiene lo cobrado
--
-- Va en su propia migración porque un valor nuevo de enum no se puede usar en
-- la misma transacción que lo crea. La función que lo escribe llega en la 0032.

alter type booking_status add value if not exists 'no_show';
