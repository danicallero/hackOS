# Datos relevantes incorporados desde ERS

Este documento resume reglas de ERS que conviene mantener como guardrails de desarrollo.

## 1) Invariantes duros

1. Un repo tiene como máximo una entrada de cola por reto.
2. Como máximo una entrada `in_room` o `presenting` por sala; `called` puede tener varias 
3. Evaluación 1:1 con su entrada de cola.
4. El identificador de badge es único mientras está asignado.
5. Cada acción de cola genera exactamente una fila de historia y un broadcast.
8. Sin email primario verificado no se avanza de `submitted` en la application.
10. Un ticket por usuario confirmado; no se consume ni se anula.
11. Pase-badge solo existe si el usuario tiene badge y un miembro del staff con capacidad para acreditar le emite un badge virtual (wallet/google api).
12. No hay aforo de sala a nivel lógico de sistema.
13. Rol derivado de relaciones; no se guarda como verdad de permisos.

## 2) Reglas no funcionales críticas

- Concurrencia real en cola con bloqueo de fila y un único ganador por transición.
- Idempotencia en todas las mutaciones de estado.
- Auditabilidad transaccional: historia de dominio + auditoría unificada.
- Permisos en frontera por capacidades (no por rol).
- i18n mínimo en/es/gl en UI y comunicaciones, pero abierto a extensiones. Cuando se creen
actividades/retos/notificaciones/avisos manualmente por el staff, se debe permitir la multiple traducción de contenido, tanto manual, como mediante alguna llamada a un servicio de traducción/IA local de traducción.
- Carga aislada: lecturas públicas y de participante no deben degradar escrituras operativas.
- Controles de UI que disparan red deben deshabilitarse mientras la petición está en vuelo.
- Flujos de escáner toleran red degradada con reintentos idempotentes.

## 3) Máquina de estado de applications (referencia)

`draft -> submitted -> review -> accepted|rejected`

`accepted -> confirmed|declined|expired`

- Decisión interna hasta envío de lote.
- Confirmación/declive por 3 vías: enlace, web autenticada, override admin.
- Sin waitlist funcional.

## 4) Máquina de estado de cola (referencia)

Estados clave:
`waiting | called | in_room | presenting | completed | disqualified`

Acciones operativas:
- `call_next`, `notify_enter`, `bring_in`, `start`, `complete`
- `send_back_to_waiting`, `requeue`, `re_enter`
- `no_show`, `skip`, `disqualify`

Notas críticas:
- `no_show` es decisión humana.
- Debe existir garantía dura de no llamar equipos con miembros ocupados en otra sala.
- Pausar sala reinyecta `called` al tope de cola, `in_room` o `presenting` se mantienen.
- `in_room` y `presenting` se pueden reinyectar a `called` para eliminarlos de la sala, pero no se puede reinyectar a `waiting` sin pasar por `called`.
- Siempre se mantiene el orden de llegada a la hora de reinyectar. Alguien que venga de `in_room` a `called` se pone al tope de la cola, de reinyectar a waiting, el que mas tiempo lleve en `called` se pone al tope de la cola de `waiting`.
- Al reencolar manualmente a un equipo porque no estaba cuando se le ha llamado, marcará una instancia del proyecto, que será visible a efectos de poder descalidicarlo si se repite reiteradamente. Esto se puede hacer desde la UI de staff o juez, y se debe poder ver el historial de reencolados de un equipo. El staff manualmente tambien puede mandar al final a alguien que lo pida, y no se le incrementará no-show.
- Es posible llamar manualmente a un equipo a la sala o a la waiting room (called), independientemente de donde esté en la cola.

## 5) Procesos de fondo a contemplar

1. Pump de auto-llamada por sala activa y cupo.
2. Expirador de confirmaciones de plaza.
3. Publicador de visibilidad programada (retos/horario/anuncios).
4. Dispatcher de notificaciones con outbox durable y reintentos.