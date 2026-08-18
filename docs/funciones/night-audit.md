# Estadías sin cerrar

Qué pasa cuando llega la fecha de salida y la reserva sigue abierta.

En hotelería esto se revisa en el **cierre de día** —*night audit*—, y el nombre
importa porque trae consigo una forma de resolverlo que no es la obvia.

---

## El problema

La máquina de estados de una reserva avanza así:

```
pending ──▶ confirmed ──▶ checked_in ──▶ completed
   │             │              │
   └──▶ expired  └──▶ cancelled └──▶ cancelled
```

Cada paso lo da una persona. `expire_stale_bookings()` cierra sola las
`pending` que nadie pagó, pero **solo esas**. De ahí en adelante nada avanza si
nadie pulsa un botón, y hay dos formas de quedarse a medias:

| | Estado | Qué pasó | Término del sector |
|---|---|---|---|
| **A** | `confirmed` | Pasó la salida y nunca se marcó la entrada | *no-show* |
| **B** | `checked_in` | Pasó la salida y nunca se marcó la salida | *skipper* |

Sin nada que lo mire, esas reservas se quedan abiertas para siempre: salen del
calendario cuando su rango vence, pero siguen contando como activas en listados
y ocupación, y ensucian los números desde el primer mes.

**Los dos casos no son el mismo problema.** B es benigno: el huésped estuvo, se
fue, y nadie tocó el botón. A toca dinero: un no-show normalmente **retiene** lo
cobrado, mientras que una cancelación **devuelve** según la política de
cancelación. Confundirlos es cobrar de más o de menos.

---

## Por qué no lo cierra un cron

La solución que se ocurre primero es un proceso nocturno que pase a `completed`
lo que ya venció. **No se hace**, por la misma razón por la que
`staff_check_out()` se niega a cerrar con saldo pendiente: cerrar una reserva
cierra también una cobranza, y una reserva que se cierra sola es una que nadie
vuelve a mirar.

En el caso A es peor. La aplicación sabe **qué no se registró**; no sabe **por
qué**. Puede que el huésped no apareciera, que llegara y nadie lo anotara, o que
avisara por WhatsApp y se acordara otra cosa. Marcarlo automáticamente como
no-show decide sobre dinero con información que la app no tiene.

Es también como lo resuelve el sector. En el cierre de día un no-show no se
cierra: se señala, y el auditor elige entre tres caminos —registrar la entrada,
cancelar, o cobrar la penalización y cancelar. Ver [referencias](#referencias).

> Es preferible un falso positivo revisable por una persona a un falso positivo
> marcado por código.

---

## Cómo funciona en la app

### La señal se deriva, no se guarda

No hay columna, ni estado nuevo, ni proceso que escriba nada. La condición se
evalúa en cada carga del panel:

```sql
status in ('confirmed', 'checked_in') and check_out < business_today()
```

Consecuencias de derivarla en lugar de escribirla:

- **Se cura sola.** En cuanto el operador registra lo que faltaba, el aviso
  desaparece. No queda fila que corregir.
- **No hay falso positivo persistente.** Nada que un proceso mal escrito pueda
  dejar mal grabado y haya que limpiar después.
- **No toca el cálculo de reembolso**, que es la parte delicada.

### El corte es `check_out`, no `check_in`

Deliberado. Entre la llegada y la salida el huésped todavía puede aparecer —una
entrada tardía es normal—, así que avisar el mismo día de llegada sería ruido
diario. Y es `<`, no `<=`: la que sale hoy no se señala hasta mañana.

### Dónde sale

Bloque **«Requieren revisión»** en `/admin`, por encima de las cifras y de las
llegadas del día. Es lo primero que se ve al abrir el panel.

`src/app/admin/page.tsx` — consulta con `.limit(20)` y `.order('check_out')`, las
más viejas primero.

### Qué dice cada línea

Nombra **lo que falta**, no un diagnóstico:

| Estado | Texto |
|---|---|
| `confirmed` | «Nunca se marcó la entrada» |
| `checked_in` | «Entró y no se marcó la salida» |

Llamarlo «no-show» sería decidir por el operador, y de esa decisión depende si se
devuelve dinero o se retiene. Junto a cada línea, cuánto lleva vencida: «salió
ayer» o «hace N días».

### Cómo se resuelve

Con lo que ya existe, en la ficha de la reserva:

| Situación | Acción | Función |
|---|---|---|
| Llegó tarde y sigue alojado | Marcar entrada | `staff_check_in()` |
| Estuvo y se fue | Marcar salida | `staff_check_out()` |
| No apareció | Cancelar | `staff_cancel_booking()` |

Dos guardas heredadas que siguen aplicando:

- **`staff_check_in()` avisa si es anticipada, pero no la impide.** Devuelve
  `early: true` cuando la fecha de llegada aún no ha llegado. El operador sabe
  mejor que la app si la habitación está lista.
- **`staff_check_out()` se niega con saldo pendiente.** Hay que marcar «cerrar
  con saldo pendiente de todos modos» para forzarlo. A veces se acuerda cobrar
  después, pero tiene que ser una decisión consciente y no un descuido.

---

## El día del negocio

Construyendo esto apareció un fallo previo que la habría disparado antes de
tiempo.

Postgres corre en UTC y Venezuela va cuatro horas por detrás. El panel componía
sus consultas con `new Date().toISOString().slice(0, 10)`, así que **entre las 8
de la noche y la medianoche «hoy» ya era mañana**: las «llegadas de hoy»
mostraban las del día siguiente durante las cuatro horas de más uso, y esta señal
se habría disparado con un día de antelación — justo el falso positivo que se
quería evitar.

La base ya lo resolvía con `business_today()`. Ahora existe su contraparte en
Next:

```ts
// src/lib/business-date.ts
businessToday()            // 'YYYY-MM-DD' en la zona del negocio
daysBetween(from, to)      // días completos entre dos fechas sin hora
```

Lee `BUSINESS_TIMEZONE`, que estaba declarada y sin usar. Corregido también en
`/admin/calendario`, que arrancaba la rejilla en el día equivocado por lo mismo.

`en-CA` como *locale* no es un idioma elegido: es el que produce `YYYY-MM-DD`,
que es lo que espera Postgres para una `date`.

---

## Comprobado

Siete reservas de juguete en distintas situaciones, en una transacción que se
deshace:

```
día del negocio: 2026-08-15 · señaladas: 2 de 7

ok   no-show señalado                    ok   reserva futura NO señalada
ok   salida sin registrar señalada       ok   la que sale hoy NO señalada
ok   estadía en curso NO señalada        ok   completada NO señalada
                                         ok   cancelada NO señalada
ok   sigue señalada tras marcar entrada
ok   deja de señalarse al cerrarla
```

Las dos últimas son las que importan para el diseño: registrar la entrada de un
no-show **no** apaga el aviso —falta la salida— y cerrarla sí. La señal sigue el
estado real sin que nadie la mantenga.

---

## Lo que no cubre

**No existe el estado `no_show`.** Hoy la única salida para el huésped que no
apareció es cancelar, que calcula reembolso según la política. Si en la práctica
se le retiene todo, hace falta un estado propio que libere las fechas sin pasar
por ese cálculo. Es una decisión sobre dinero y está pendiente de consultar con
operadores reales. Ver `PENDIENTES.md`.

**No hay salida tardía ni extensión de estadía.** Si el huésped se queda una
noche más no hay forma de alargar la reserva: habría que crear otra, y el
`EXCLUDE` de `unit_holds` la rechazaría si esa noche ya está tomada.

**La señal solo sale en el panel.** El listado de `/admin/reservas` no la
distingue ni permite filtrar por ella. Con pocas reservas no hace falta; con
muchas, sí.

---

## Referencias

Consultadas en agosto de 2026.

| Fuente | Qué aporta |
|---|---|
| [Addressing No Show Reservations — RoomKey PMS](https://support.roomkeypms.com/a/435754-addressing-no-show-reservations-mandatory-task) | Los tres caminos del auditor: registrar la entrada, cancelar, o cobrar penalización y cancelar. Todos humanos |
| [Hotel Night Audit Process — Hotelogix](https://blog.hotelogix.com/night-audit-process/amp/) | Qué es el cierre de día y qué reportes produce |
| [Departure Procedures Using PMS — Hospitality.Institute](https://hospitality.institute/bha206/departure-procedures-pms-hotels/) | El *skipper*: huésped que se va sin registrar salida. Se reconcilia en el cierre de día |
| [No-Show Report — Cloudbeds](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/25911886841755-No-Show-Report) | El no-show se marca a mano **o** automáticamente; lo automático es una opción que se activa, no el comportamiento por defecto |
| [By the time your PMS flags a no-show — AeroGuest](https://aeroguest.com/next-gen-hotel-insights/by-the-time-your-pms-flags-a-no-show-the-room-has-been-empty-for-six-hours/) | Crítica al **momento**, no al método: señalar a las 3 AM llega tarde para revender la habitación. Apunta a avisar temprano, no a automatizar la decisión |

Nota sobre la última: en un hotel grande la crítica pesa porque hay inventario
que revender esa misma noche. En una posada con pocas unidades y reserva
anticipada pesa mucho menos, y por eso aquí la señal vive en el panel —que el
operador abre por la mañana— y no en una alerta nocturna.

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Consulta y bloque «Requieren revisión» | `src/app/admin/page.tsx` |
| Día del negocio en Next | `src/lib/business-date.ts` |
| Día del negocio en Postgres | `business_today()`, migración `0002` |
| Entrada y salida | `staff_check_in()`, `staff_check_out()`, migración `0014` |
| Expiración de `pending` | `expire_stale_bookings()`, migración `0001`; cron en `0005` |
| Botones de la ficha | `src/components/booking-actions.tsx` |
| Acciones de servidor | `src/app/admin/reservas/[code]/actions.ts` |

Decisiones 9 y 9.1 de `ARCHITECTURE.md`.
