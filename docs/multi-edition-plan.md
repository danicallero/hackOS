# Plan: soporte multiedición en la base de datos

Estado: **implementado** en un único PR con una sola migración
(`apps/api/db/migrations/1001_multi_edition.sql`). La sección 12 recoge el
inventario de la Fase 0 y las diferencias entre este plan y la implementación;
donde discrepen, manda la sección 12. Las fases 1-9 de la sección 4 se
entregan juntas, no como PRs separados.

## 1. Objetivo y decisiones tomadas

Una instalación de hackOS debe servir varias ediciones sin mezclar sus datos y
sin que la persona pierda su identidad.

| Decisión | Resultado |
|---|---|
| Usuarios, perfil, preferencias | **Globales**, persisten entre ediciones |
| Empresas | **Por edición** (una fila por empresa y edición) |
| Roles | **Por edición** (`user_roles` lleva edición). Solo `system:superadmin` es global, provisionado por CLI |
| `roles` y `role_capabilities` | **Globales**: un solo catálogo de roles, cada edición asigna personas |
| Mentor y similares | Se guarda por edición; si en una edición no tiene el rol, no se muestra, pero el dato queda |
| Catálogos (universidades, titulaciones, `form_libraries`, `help_topics`) | Globales y persistentes |
| Proyectos de años anteriores | Enlazables y estables para siempre |
| Un usuario ve las ediciones en las que participó | Sí, con un selector de edición en web y mobile (solo si hay más de una) |
| Sin rol en la edición activa | Es una persona que **aún no ha aplicado**: ve el flujo de solicitud de esa edición, igual que un usuario nuevo |
| Edición por defecto | Al iniciar sesión, siempre la **última edición activa**. Las anteriores se consultan a voluntad |
| Edición cerrada | Una edición pasa a **solo lectura** al cerrar el evento. Quien tuvo rol en ella la navega como si estuviera en curso (mismas pantallas y permisos de lectura), pero no puede modificar nada. Solo se escribe si la edición se **reabre** o quien actúa es **superadmin** |
| Concepto de producto | La plataforma se instala una vez y cada año se crea una edición nueva; cada participante aplica de nuevo como si fuese una instancia nueva |
| Borrado de datos | Borra todo: usuario, perfil y participación de todas las ediciones |
| Datos de producción | Ya existen; la migración parte de una sola edición (la actual), así que el backfill es determinista |

## 2. Modelo propuesto

- Tabla nueva `editions(event_key PK, name, starts_at, ends_at, status)` con
  `status` en `draft | active | closed`; una edición cerrada puede reabrirse. `event_key` mantiene el formato actual
  (`^[a-z0-9][a-z0-9-]{0,39}$`).
- `event_config.event_key` sigue siendo la edición activa y pasa a tener FK a
  `editions`.
- Las tablas por edición llevan `event_key text NOT NULL REFERENCES editions`.
  Las tablas que cuelgan de una fila ya ligada a una edición (por ejemplo
  `sponsor_stand_tags` de una empresa) la heredan por la FK y no necesitan
  columna propia.
- Roles protegidos (`is_protected`, hoy solo `system:superadmin`) pueden
  asignarse con `event_key NULL`; un `CHECK` impide `NULL` en el resto.

### Clasificación de tablas

**Ya llevan `event_key`:** `applications`, `activity_rsvps`,
`activity_rsvp_settings`, `mentor_profiles`, `onboarding_step_states`,
`user_role_event_evidence`, `event_attendance_kinds`.

**Globales (sin cambios):** `users`, `accounts`, `sessions`, `verifications`,
`user_public_profiles`, `user_email_history`, `notification_preferences`,
`push_tokens`, `roles`, `role_capabilities`, `role_seed_defaults`,
`universities`, `university_degrees`, `form_libraries`, `form_library_values`,
`help_topics`, `audit_log`, `idempotency_keys`.

**Pasan a ser por edición:**

| Grupo | Tablas | Cómo |
|---|---|---|
| Roles | `user_roles` | `event_key` en la clave primaria; `NULL` solo para roles protegidos |
| Empresas | `enterprises` | `event_key` propio; unicidad `(event_key, name)` en vez de `name`; sin vínculo entre ediciones |
| Cuelgan de empresa (heredan) | `sponsors`, `sponsor_stand_tags`, `sponsor_faq`, `enterprise_judges`, `enterprise_invite_links`, `user_invite_links`, `role_grant_rules`, `room_enterprises`, `queue_groups`, `schedule_enterprises` | por FK, sin columna propia salvo que haga falta filtrar sin join |
| Retos | `challenges`, `challenge_versions`, `challenge_winners` | heredan de empresa; opcionalmente `event_key` desnormalizado con comprobación |
| Proyectos | `repos`, `submissions`, `project_*`, `repo` ligados a GitHub | `event_key` (heredan del reto cuando hay uno) |
| Colas y jueces | `queue_*`, `rooms`, `judging_*`, `attempt_review*` | por edición |
| Agenda | `schedule`, `schedule_speakers`, `schedule_owners`, `activities`, `activity_logs` | `event_key` |
| Operación | `tickets`, `check_in_logs`, `time_logs`, `meal_scan_*`, `wallet_*`, `scanner_revoked_*` | `event_key` |
| Ayuda | `helper_profiles` (+ `helper_*`), `help_requests`, `helpdesk_open_windows` | `event_key`; el perfil de helper pasa de 1:1 con `users` a uno por edición |
| Comunicación | `announcements`, `announcement_*`, `notification_automation_settings`, `notification_outbox`, `content_reports` | `event_key` |
| Diario | `diary_entries` | `event_key` para personas; para empresas lo implica la empresa |
| Certificados y estadísticas | `attendance_certificates`, `certificate_*`, `statistics_*` | `event_key` |
| Participación | nueva vista `edition_participation` | derivada de `user_roles`, `applications` y `event_attendance_kinds` |

La lista exacta se cierra en la Fase 0.

## 3. Autorización

- Las capabilities de un usuario se calculan con sus roles de la **edición
  activa** más los roles globales (superadmin).
- `requireCapability` y la resolución de capabilities leen `user_roles` filtrando
  por edición. Es el cambio de mayor riesgo del plan.
- `user_role_event_evidence` y `event_attendance_kinds` se derivan de
  `user_roles` por edición; se elimina la doble fuente de verdad.
- Un usuario sin ningún rol en la edición activa es tratado como alguien que
  todavía no ha aplicado: ve el flujo de solicitud de esa edición (el mismo que
  un usuario nuevo), con su perfil y preferencias globales ya rellenos.
- Las invitaciones asignan el rol en la edición activa al canjearse.
- El CLI de superadmin sigue provisionando `system:superadmin` sin edición.
- Por comprobar: caché de capabilities, contenido de las sesiones y todos los
  endpoints bajo `/api/users/:id`.

### Cierre de edición: solo lectura

- Guardia única de escritura: todas las rutas que modifican datos de una
  edición comprueban su estado. Si está `closed`, rechazan con un error de
  negocio explícito (`AppError`), salvo superadmin. Debe vivir en un único
  punto (un `preHandler` compartido más un chequeo dentro de `withTransaction`
  para las tablas con `event_key`), no repetirse por ruta.
- Las capabilities en una edición cerrada se reducen a las de lectura: una
  capability de escritura no se concede aunque el rol la tenga. Hace falta una
  clasificación lectura/escritura de `capabilities.ts` (por comprobar si ya
  existe).
- Los workers y las notificaciones programadas ignoran las ediciones cerradas.
- Los escáneres y los QR de una edición cerrada responden "evento cerrado" y no
  escriben.
- Reabrir y cerrar se registran en `audit_log` (H53) y emiten evento SSE.
- **Efectos del cierre** (en una sola transacción, auditados, idempotentes):
  - **Envíos de proyecto:** dejan de aceptarse. Un proyecto que seguía en
    `draft` queda como `not_submitted` (ya existe ese estado en
    `repos.submission_status`).
  - **Colas:** se cierran. Las entradas en espera o sin resolver no se evalúan:
    quedan como **no evaluadas** (los exports ya muestran `not_evaluated` para
    un proyecto sin revisión) y no se penaliza a nadie. Hay que revisar qué
    estado de `queue_entries` representa eso sin inventar un estado nuevo
    (por comprobar).
  - **Peticiones de ayuda:** las `open` y las `claimed` pasan a `cancelled`
    (estado que ya existe en `help_requests.status`), porque el evento terminó
    y ya no se van a resolver. Las `resolved` no se tocan.
  - **Ventanas de ayuda, rooms y sesiones de juicio activas:** se cierran.
  - **Sin notificaciones:** cancelar o cerrar por el cierre de la edición no
    envía ningún aviso (ni push, ni email, ni en la app) a equipos ni helpers.
    El evento terminó y no hay nada que comunicar. Las rutas de cancelación
    usadas por el cierre deben saltarse el `notification_outbox`.
  - **Reabrir** devuelve solo la capacidad de editar. No reactiva
    notificaciones ni programadas pendientes, no reactiva peticiones
    canceladas y no deshace los estados finales de colas y envíos.

## 4. Fases

Cada fase es un PR con **una sola migración** (convención del repo), aditiva y
con backfill hacia la edición actual. Con una sola edición, el comportamiento
visible no cambia hasta la Fase 8.

### Fase 0: inventario (sin cambios de esquema)
- Contar filas por tabla en producción.
- Listar `UNIQUE`, `PRIMARY KEY` y FK que cruzarían ediciones.
- Confirmar el estado de los backups (`backup.sh production status` y
  `verify latest`).
- Revisar qué endpoints y consultas filtran por rol y por tabla de evento.
- Entregable: este documento actualizado con la lista cerrada.

### Fase 1: `editions`
- Crear `editions` y una fila con la clave actual de `event_config`.
- FK de `event_config.event_key` hacia `editions`.
- Sin cambio de comportamiento.

### Fase 2: roles por edición
- `user_roles.event_key`: nullable, backfill con la clave actual, `NOT NULL`
  salvo roles protegidos, nueva clave primaria `(user_id, role_id, event_key)`.
- Resolución de capabilities por edición activa (código tolerante: con una sola
  edición, equivale a hoy).
- Derivar `user_role_event_evidence` y `event_attendance_kinds` de `user_roles`.
- Tests de autorización por edición, incluido superadmin global.

### Fase 3: empresas por edición
- `enterprises.event_key`; sustituir `enterprises_name_key (name)` por
  `(event_key, name)`.
- Las empresas **no son recurrentes**: cada edición crea las suyas desde cero y no hay vínculo entre las de un año y las de otro.
- Revisar los mensajes y la lógica de "nombre duplicado" en la API.

### Fase 4: participación y selector de edición
- `GET /api/me/editions`: ediciones en las que participó y con qué tipo.
- **Edición vista:** la sesión tiene una edición vista, por defecto la última
  activa. Se cambia con un selector en web y mobile, que solo aparece si existe
  más de una edición y el usuario participó en más de una (o es staff).
- **La edición vista viaja como cabecera por petición** (`X-Edition: <event_key>`),
  no como campo de la sesión. Sin cabecera, la API usa la edición activa. Los
  clientes guardan la elección en su estado local y la reinician a la última
  edición activa al iniciar sesión o abrir la app. La API comprueba que el
  usuario tiene un rol o una participación en esa edición y calcula los
  permisos con los roles de esa edición.
- Los recursos por id (`/gallery/:id`, `/companies/:id`, un proyecto, un reto)
  derivan la edición de su propia fila, no de la cabecera, así que un enlace
  compartido funciona igual para cualquiera con acceso y no depende de la
  edición que tuviera seleccionada quien lo abre.
- La cabecera entra en la clave de las cachés de lecturas de lista (la edición
  forma parte del `Vary`); las lecturas por id no la necesitan.
- Una edición cerrada se ve en **solo lectura**, con la misma navegación que el
  evento en curso: quien tuvo un rol en ella conserva ese rol para leer (staff,
  sponsors, jueces y participantes ven sus pantallas y datos de entonces), pero
  no puede escribir. Nada de escaneos, ediciones de proyecto, envíos, cambios de
  cola ni de configuración.
- La única forma de escribir en una edición cerrada es **reabrirla** (acción
  explícita y auditada, bajo `event:manage`) o actuar como **superadmin**.
- Al iniciar sesión o abrir la app siempre se empieza en la última edición
  activa, aunque la sesión anterior se hubiese quedado en una antigua.
- Filtro de edición en todos los listados que se muestran al usuario.

### Fase 5: Diario, agenda, helper
- `diary_entries.event_key` (personas) con unicidad
  `(owner_id, target_user_id, event_key)`.
- `schedule` y tablas relacionadas.
- `helper_profiles` por edición.

### Fase 6: proyectos y retos
- `challenges`, `repos`, `submissions` y `project_*` por edición.
- URL estable de proyecto (`/gallery/:id`) que muestra su edición; vista por
  edición de la galería.
- Opcional posterior: `continues_repo_id` para continuar un proyecto de otro año.

### Fase 7: operación, ayuda y comunicación
- `tickets`, `check_in_logs`, `time_logs`, `meal_scan_*`, `wallet_*`,
  `scanner_revoked_*`, `help_requests`, `announcements*`, notificaciones,
  certificados y estadísticas.
- Stands, tags NFC y QR (`STAND-…`) pertenecen a su edición y no se reutilizan: un código de una edición cerrada responde "evento cerrado" y no escribe.

### Fase 8: ciclo de vida de una edición
- Crear edición (`draft`), activar (cambia `event_config`), **cerrar**
  (solo lectura) y **reabrir**.
- Al crear una nueva: no se clona nada de empresas, stands ni retos (se crean
  desde cero); crear configuración vacía de RSVP, onboarding y formularios;
  formularios y plantillas se pueden heredar, datos de personas no.
- `PUT /api/event` auditado, bajo `event:manage`.
- Es la fase que introduce de verdad una segunda edición.

### Fase 9: borrado de datos
- Revisar el scrub de `identity/removal.ts` y la anonimización para todas las
  tablas con `event_key`.
- Test que recorre las tablas con `user_id` o FK hacia `users` y falla si
  alguna conserva filas tras el borrado completo.
- Decidir la retención anónima tras acreditación (ver preguntas).

## 5. Seguridad del despliegue

1. Backups: `BACKUPS_ENABLED=true`, última copia reciente y
   `backup.sh production verify latest` correcto antes de empezar.
2. Ensayo por fase: restaurar el último dump en una base local, correr la
   migración y comparar recuentos por tabla antes y después.
3. Backup manual (`backup.sh production`) justo antes de aplicar cada migración
   en producción; el flujo de despliegue ya lo hace antes de modificar la API.
4. Despliegue en dos tiempos: API que filtra por la edición actual (compatible
   con el esquema antiguo), migración y después el código que usa las
   restricciones nuevas.
5. Rollback: `restore` o `undo` con la copia previa. Las migraciones aditivas
   permiten dejar la columna sin usar si hay que volver atrás.
6. Tests por fase: recuentos de backfill, unicidad por edición, autorización por
   edición y borrado completo.

## 6. Riesgos

- **Autorización (Fase 2):** un error deja a gente sin acceso o con acceso de más.
  Ensayar con una copia de producción y con tests por rol y edición.
- **Unicidades globales:** `enterprises.name`, `(owner_id, target_user_id)` y
  cualquiera que la Fase 0 encuentre. Deben pasar a ser por edición.
- **QR y NFC de stands ya impresos:** apuntan a una asignación concreta. Un código
  de una edición cerrada responde "evento cerrado" hasta que se reasigna (la
  reasignación es siempre posible, ver §9). Hay que comprobar que una revocación
  de una edición no invalide el mismo código en otra.
- **Enlaces antiguos:** `/gallery/:id` y los enlaces ya compartidos deben seguir
  funcionando.
- **Anonimización:** ver §10. Hay que revisar el scrub para quitar el nombre, el
  enlace al perfil y, si es el propietario, el enlace al repositorio, sin borrar
  el proyecto público.
- **Clientes mobile antiguos:** la app y la API deben seguir compatibles mientras
  haya una sola edición.

## 7. Documentación y tests asociados

- Actualizar `docs/database-schema.md`, `docs/onboarding.md`,
  `docs/account-deletion.md`, `docs/navigation.md` y la tabla de módulos de
  `docs/api-reference.md`.
- Cada ruta nueva con `description` en su esquema.
- Entrada en `docs/README.md` para este documento al adoptarlo.

## 8. Decisiones cerradas

_Ver también §9 y §10 para la reasignación de códigos y la anonimización._

1. **Retención anónima:** global, sin cambios en `anonymous_participants`.
2. **Proyectos de ediciones cerradas:** públicos y enlazables para siempre, salvo
   que su autor se anonimice, momento en que deja de mostrarse su autoría.
3. **Usuario sin rol en la edición activa:** solicitante sin aplicar, ve el
   flujo de solicitud.
4. **Empresas recurrentes:** no existen; cada edición crea las suyas y no hay
   `source_enterprise_id`.
5. **Stands, tags NFC, QR y acreditaciones:** los datos del stand (empresa,
   retos, tags en uso) pertenecen a su edición, pero las **etiquetas NFC y las
   pulseras o acreditaciones físicas siempre pueden reasignarse**, también entre
   ediciones. Una persona que llega con la acreditación de una edición anterior
   puede recibirla de nuevo en la actual.
6. **Staff de una edición pasada:** puede abrir su panel, en solo lectura.
7. **Cierre de edición:** cierra envíos, cierra colas (pendientes como no
   evaluados) y cancela peticiones de ayuda, sin notificar a nadie. Reabrir solo
   devuelve la capacidad de editar.
8. **Edición vista:** cabecera `X-Edition` por petición, con la última edición
   activa por defecto. Los recursos por id derivan la edición de su fila.
9. **Tipo de `event_key`:** texto con FK a `editions(event_key)`. Ya es el
   formato de las 7 tablas existentes y de `event_config`, es legible en URLs y
   exports y evita reescribir las claves; un id numérico no aporta nada a
   cambio. Su formato queda restringido con un `CHECK` (`^[a-z0-9][a-z0-9-]{0,39}$`)
   y una clave no se renombra tras crearse.

## 9. Reasignación de etiquetas, pulseras y acreditaciones

- **Modelo:** el código físico (NFC UID, `STAND-…`, `users.badge_id`) es un
  identificador reutilizable; lo que pertenece a una edición es la **asignación**
  a una empresa o a una persona. Reasignarlo no borra la historia: las entradas
  del Diario, los check-ins y los logs apuntan a la empresa o persona, no al
  código.
- **Un código tiene un solo titular a la vez:** sigue siendo único globalmente
  y no se puede reasignar un código que esté **en uso por un titular activo de
  la edición actual**. Solo se reasigna un código libre o cuyo titular es de una
  edición cerrada.
- **Etiquetas de stand (`sponsor_stand_tags`):** `code` sigue siendo único
  globalmente. Reasignar mueve la etiqueta a otra empresa de la edición actual
  (acción explícita de staff, auditada). Un código de una edición cerrada
  responde "evento cerrado" mientras no se reasigne.
- **Acreditaciones y pulseras (`users.badge_id`, `badge_id_history`):** una
  persona con la acreditación de una edición anterior puede recibirla de nuevo
  en la actual. El check-in en puerta o el mostrador detecta que el código
  pertenece a un titular de otra edición y ofrece **reasignarlo** a la persona
  actual; el titular anterior conserva su historial de esa edición.
  `badge_id_history` pasa a registrar la edición de cada asignación. Si el
  código lo tiene un titular activo de la edición actual, se rechaza con un
  error de negocio explícito y no se reasigna.
- **Tickets (`tickets`):** hoy la clave primaria es `user_id` (un ticket por
  usuario). Pasa a `(user_id, event_key)`; `token` sigue siendo único.
- Por comprobar: la restricción de unicidad de `users.badge_id` y cómo
  `scanner_revoked_badges` y `scanner_revoked_tickets` interactúan con un
  código reasignado (una revocación de 2027 no debe invalidar la acreditación en
  2028).

## 10. Anonimización y datos públicos entre ediciones

- **Proyectos públicos:** al anonimizarse una persona, el proyecto se conserva
  entero salvo lo que es suyo personal: su **nombre** y el **enlace a su
  perfil** desaparecen. Si esa persona es la **propietaria del repositorio**
  (lo vinculó desde su perfil), también se pierde el **enlace al repositorio**.
  El resto del proyecto (descripción, fotos, vídeo, equipo restante, retos)
  sigue público.
- **`anonymous_participants`:** pasa a registrar las ediciones en las que
  participó (`event_key` y minutos de presencia garantizada por edición), sin
  mapeo a ninguna persona. La retención sigue siendo global; lo que se añade es
  *en qué* participaron.
- **Certificados:** los de años anteriores son **descubribles y verificables**.
  La verificación pública por código o hash (`verifyCode`, `verifyByHash`) debe
  funcionar para cualquier edición, también la cerrada, indicando a qué
  edición pertenece. Un certificado emitido en una edición cerrada no se
  invalida por el cierre.
- **Certificados de una persona anonimizada: se borran.** No se conservan (no
  podemos conservarlos) y la verificación de su código responde como un
  certificado inexistente. La persona ya no puede acreditar que asistió: es una
  consecuencia asumida de anonimizarse. El scrub de `identity/removal.ts` debe
  borrar `attendance_certificates` y `certificate_approvals` de todas las
  ediciones del usuario.
- **Nombres de proyecto:** no se tratan de forma especial. Si el nombre de un
  proyecto revela a una persona anonimizada, el proyecto sigue siendo público
  con ese nombre; quien lo creó debió elegir otro. No hay lógica de renombrado
  ni de ocultación.
- **Una persona ve sus certificados de todas las ediciones**, agrupados por
  edición.

## 11. Pendiente de comprobar en el código

No hay decisiones de producto abiertas. Quedan estas comprobaciones:

1. La restricción de unicidad de `users.badge_id` y cómo
   `scanner_revoked_badges` y `scanner_revoked_tickets` tratan un código
   reasignado entre ediciones.
2. Qué estado de `queue_entries` representa "no evaluado" al cerrar las colas.
3. Si `capabilities.ts` ya distingue capacidades de lectura y de escritura.
4. Que el scrub de borrado y anonimización cubre todas las tablas nuevas con
   `event_key`, incluidos los certificados de todas las ediciones.

## 12. Fase 0 e implementación

### Inventario (comprobado contra el esquema de `staging`)

- El esquema tiene **123 tablas** de dominio más el ledger `_migrations` (no
  126) y 5 vistas (`user_effective_capabilities`, `user_effective_role_name`,
  `user_event_access`, `project_eligibility`, `event_attendance_kinds`).
- Unicidades que cruzaban ediciones y ahora son por edición:
  `enterprises.name` → `(event_key, name)`; `diary_entries (owner_id,
  target_user_id)` → con `event_key`; `tickets` PK `user_id` →
  `(user_id, event_key)`; `certificate_approvals` PK `user_id` →
  `(user_id, event_key)`; `helper_profiles` PK `user_id` →
  `(user_id, event_key)` (y sus hijas); `scanner_revoked_badges/tickets` PK
  `credential_digest` → `(credential_digest, event_key)`; el pase vivo de
  `wallet_passes` y el certificado vivo de `attendance_certificates` incluyen
  la edición. Se mantienen globales: `users.badge_id`,
  `sponsor_stand_tags.code`, `tickets.token`, `attendance_certificates.code`.
- Singletons `id = 1` (`event_config`, `queue_settings`, `wallet_settings`,
  `certificate_settings`, `notification_automation_settings`,
  `live_activity_settings`, `sponsor_faq`): siguen siendo la configuración de
  la **edición actual**. Al activar otra edición, `event_config` se guarda en
  `editions.settings_snapshot` (sin la contraseña Wi-Fi) y la nueva empieza sin
  ventanas, fases ni onboarding. Las rutas que los escriben se declaran
  `edition: "current"` y se rechazan mientras se ve otra edición.
- `notification_outbox`, `audit_log`, `idempotency_keys` y los catálogos son
  globales.

### Respuestas a la sección 11

1. `users.badge_id` es único global (`users_badge_id_key`). El historial era
   una columna `users.badge_id_history text[]` que el escáner trataba como
   códigos revocados sin edición; ahora es la tabla `badge_id_history (user_id,
   badge_id, event_key, released_at)` y `users.badge_event_key` guarda la
   edición de la asignación actual (lo sella el trigger de asignación). Las
   revocaciones de escáner llevan `event_key` y solo cuentan en su edición.
2. `queue_entries` no tiene estado "no evaluado": se usa `cancelled`, el
   mismo estado terminal que ya usa vaciar una cola. Queda fuera de recuentos y
   de penalizaciones y los exports muestran `not_evaluated` porque no hay
   revisión. Cada entrada cancelada deja una fila `queue_history` con acción
   `edition_close`.
3. `capabilities.ts` no distinguía lectura y escritura. Se añade
   `CAPABILITY_ACCESS` (exhaustivo): en una edición cerrada solo sobreviven las
   capacidades `read`; `*` se expande a todas las de lectura.
4. Ver `docs/account-deletion.md`: el borrado y la anonimización recorren
   todas las ediciones y hay un test que recorre todas las FK hacia `users`.

### Diferencias con el plan

- **Numeración:** la migración es `1001_multi_edition.sql` (nueva banda
  `10xx`): debe ordenarse después de todas las anteriores, de las que depende.
- **Clave de `user_roles`:** una clave primaria no admite `NULL`, así que la
  clave es `UNIQUE NULLS NOT DISTINCT (user_id, role_id, event_key)`. Un `CHECK`
  no puede leer `roles.is_protected`: lo hace el trigger
  `user_roles_edition_scope`, que pone `NULL` a los roles protegidos y rechaza
  `NULL` en el resto.
- **`user_role_event_evidence`** pasa a ser una vista sobre `user_roles`; las
  filas de evidencia de ediciones anteriores se migran como roles de esa
  edición. `event_attendance_kinds` cubre todas las ediciones.
- **Edición vista en SQL:** la función `current_edition()` devuelve la
  edición de `X-Edition` (fijada por la API como `hackos.edition` en la
  conexión o transacción de esa petición) o, sin cabecera, la actual. Las
  columnas `event_key` tienen ese valor por defecto y los listados filtran por
  él. Las hijas con columna propia la heredan del padre por trigger.
- **Guardia de escritura:** un único `preHandler` para todas las mutaciones
  (opt-out `edition: "global"`) más un trigger en cada tabla con edición
  (SQLSTATE `HKE01`), que mapea a `EditionClosedError` (409
  `edition_closed`).
- **Edición en borrador:** solo el superadmin global la ve. Quien tenga roles
  en ella también, una vez publicada.
- **Selector:** `GET /api/me/editions` devuelve las ediciones que el usuario
  puede ver; el superadmin global ve todas. El selector aparece cuando hay más
  de una.
- **Clave `default`:** el primer cambio de clave desde `PUT /api/event`
  renombra la edición `default` (las FK propagan el cambio con `ON UPDATE
  CASCADE`). Es el único renombrado posible; cualquier otro cambio de clave
  crea o activa una edición.
- **Ventanas de ayuda:** al cerrar, las ventanas de `helpdesk_open_windows` y
  la disponibilidad de helpers en curso terminan ahora y las futuras se
  eliminan.

### Certificados tras el cierre

- Cerrar congela lo que administra la organización, no lo que un participante
  puede obtener después: cada persona puede **autoemitirse su certificado**
  de una edición cerrada (`POST /api/me/certificates` y
  `POST /api/me/certificates/issue`, declaradas `edition: "self-service"`),
  con las mismas reglas de elegibilidad. La emisión, revocación y
  configuración por parte del staff siguen bloqueadas hasta reabrir.


Al volver a activar una edición existente se restauran sus ventanas temporales
y su configuración de onboarding desde `settings_snapshot`; solo una edición
nueva empieza con estos valores vacíos. La revisión de onboarding aumenta
al cambiar de edición. Las credenciales Wi-Fi no se guardan en el snapshot.
