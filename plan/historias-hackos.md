# hackOS — Historias de usuario

hackOS es una plataforma única de gestión para hackathones. Sustituye a las
cuatro herramientas sueltas que usábamos hasta ahora (la db de contenido público, el
gestor de inscripciones, la app de acreditación por QR y el sistema de colas de
judging), que no compartían datos entre sí.

## 0. Aclaraciones técnicas de plataforma

- Arquitectura: API (Fastify + BullMQ), web (Next.js) y móvil
  (React Native + Expo), con `packages/typescript-config` compartido.
- Autenticación: Better Auth vive dentro de la API de Fastify; la app móvil usa el
  plugin oficial de Expo y guarda la sesión en `expo-secure-store`.
- Archivos: cualquier subida va por el SDK S3 contra MinIO autohospedado.
- Correo: proveedor configurable por base de datos con adaptadores para Resend,
  SMTP y Postal; todo envío sale asíncrono por BullMQ.
- Memoria/colas: Valkey soporta BullMQ y los microestados en tiempo real de judging.
- Móvil operativo: alertas con Expo Push Notifications y badges offline-first en
  SQLite local, con validación QR local y sincronización posterior; las comidas y
  actividades usan cola local con reintentos idempotentes para no perder registros.
- TV y judging: SSE nativo en Fastify para pantallas; nada de WebSockets complejos.
- Apple Wallet: los pases `.pkpass` se sirven con endpoints nativos y actualización
  del pase cuando cambie el estado del participante.
- Fuente de verdad: la base de datos de hackOS manda; los importes externos solo la
  alimentan.

---

## 1. Cuenta e identidad

Todo el mundo entra al sistema con una cuenta propia; no hay cuentas compartidas ni
accesos por hoja de cálculo. A priori todas las cuentas son iguales: cada una lleva
un rol ilustrativo (participante, staff, juez…) que orienta lo que se ve en pantalla,
pero los permisos reales no dependen de ese rol sino de **grupos de capacidades** que
administración concede y retira.

¿Qué es un grupo de capacidades? Un conjunto de cosas concretas que una cuenta puede
hacer. Un administrador lo puede hacer todo; pero a un miembro del staff al que le
creas la cuenta el mismo día del evento igual no te interesa darle acceso a los datos
de todos los usuarios, ni a modificar actividades, ni a aceptar solicitudes: solo
quieres que pueda escanear acreditaciones para hacer check-ins o registrar
actividades. O quieres a alguien que únicamente lea las inscripciones y no toque nada
más. Todo eso se define con grupos, y se pueden crear incluso grupos de grupos, para
no repetir la misma lista de permisos veinte veces. Una misma persona puede acumular
varios (un juez que también compite, por ejemplo).

**H1. Crear una cuenta**
Como visitante quiero registrarme con mi nombre, apellidos, correo y contraseña para
poder inscribirme al evento.
Al registrarme recibo un correo con un código para verificar mi dirección. Hasta que
no verifico, puedo entrar pero no hacer nada transaccional (inscribirme, confirmar
plaza…). La cuenta vive en Better Auth dentro de la API y los correos salen por la
cola asíncrona configurable. Si el correo ya existe, se me avisa sin revelar nada más.

**H2. Verificar el correo**
Como solicitante quiero confirmar mi dirección siguiendo el enlace del correo para
desbloquear el resto del sistema. Si el enlace caducó, puedo pedir otro; si ya lo usé,
se me dice que ya estoy verificado en lugar de dar error.

**H3. Reenviar la verificación**
Como usuario sin verificar quiero pedir que me reenvíen el correo si no me llegó.
Hay un límite (3 por hora, con 60 segundos entre intentos) para evitar abusos, y la
pantalla muestra cuánto falta para poder reintentar.

**H4. Entrar y salir**
Como usuario quiero iniciar y cerrar sesión. La sesión se mantiene entre visitas sin
tener que volver a escribir la contraseña cada vez. Al cerrar sesión, esa sesión deja
de valer de verdad, también en el servidor. En la app móvil la misma sesión se
mantiene con el plugin oficial de Better Auth para Expo y `expo-secure-store`.

**H5. Recuperar la contraseña**
Como usuario quiero pedir un enlace de recuperación si olvidé mi contraseña. La
respuesta es la misma exista o no el correo (no se puede usar el formulario para
averiguar quién está registrado). El enlace se envía por el sistema de correo
asíncrono configurable. Al fijar contraseña nueva se cierran todas mis sesiones
antiguas.

**H6. Correo secundario**
Como participante quiero añadir y verificar una segunda dirección de correo, porque en
Devpost me registré con otra cuenta y así el sistema podrá reconocer mis proyectos al
importarlos. Ese correo secundario no puede coincidir con el correo primario de nadie
ni con el secundario de otra persona: cada dirección identifica a una única cuenta.

**H7. Editar mi perfil**
Como usuario quiero consultar mis datos (nombre, teléfono, talla de camiseta, idioma,
restricciones alimenticias…), y si detecto un error un miembro de la organización podrá
modificarlo para que acreditación y comidas trabajen con información
correcta. La plataforma funciona en castellano, gallego e inglés; el idioma elegido
aplica a correos y pantallas.

**H8. Gestionar permisos por grupos de capacidades**
Como administración quiero crear grupos de capacidades (y grupos que agrupen a otros
grupos), y asignar o quitar personas, para dar a cada cuenta exactamente el acceso
que necesita: el escáner de acreditación para el voluntario de un día, solo lectura
de inscripciones para quien ayuda a revisar, todo para un administrador. El sistema
comprueba siempre la capacidad concreta, nunca el rol.

**H9. Entrar por enlace de invitación de empresa**
Como miembro de una empresa patrocinadora quiero crear mi cuenta desde el enlace de
invitación que se generó al dar de alta mi empresa, y quedar vinculado a ella
automáticamente, sin que nadie me tenga que configurar nada a mano. Si el enlace
caducó, la organización puede generar otro.

**H10. Crear cuentas por invitación (staff, sponsors y participantes añadidos a mano)**
Como administración quiero dar de alta cuentas que no pasan por inscripción — staff,
organización, sponsors — indicando solo el correo y el tipo de cuenta. El
administrador no rellena los datos de nadie: a esa dirección le llega un "crea tu
cuenta en el sistema" y es la propia persona quien, siguiendo el enlace, pone su
contraseña, su nombre y apellidos y el resto de su información. Ahí es donde mete sus
restricciones alimenticias, porque en este flujo no hay inscripción que las pida y
esta gente también come. La invitación se manda por la cola de correo asíncrona.
El mismo mecanismo sirve para el participante que entra fuera de plazo con la
inscripción ya cerrada: se le envía el "crea tu cuenta como participante" y, al
crearla, se le piden los datos relevantes de su tipo — restricciones y talla de
camiseta (de participantes y mentores necesitamos ambas por logística) — y rellena a
mano el formulario de inscripción aunque esté cerrado. Ese formulario no es papeleo:
de ahí salen el currículum que se entrega a las empresas, la fecha de fin de estudios
que ven los jueces, etcétera; si se lo saltara, sería el único participante sin esos
datos.

---

## 2. Inscripción (applications)

**H11. Publicar formularios de inscripción**
Como administración quiero definir formularios distintos por tipo de persona
(participante, mentor…) con sus campos, fechas de apertura y cierre opcional y, si aplica, un
cupo de plazas, para abrir la inscripción sin depender de nadie técnico.

**H12. Inscribirme**
Como solicitante quiero rellenar el formulario, poder guardarlo a medias y enviarlo
cuando esté listo, y consultar después en qué estado está mi solicitud.
Al enviar se me piden también las restricciones alimenticias y, en los formularios de
participante y mentor, la talla de camiseta: logística necesita ambas (el pedido de
camisetas y la comida). En ese momento se me informa con claridad de que ese dato
sensible se guarda mientras exista mi cuenta y solo se usa para planificar la
comida de quien confirma su plaza — no se borra al rechazar o caducar, porque la
organización puede darme otra oportunidad más adelante y no queremos perder el dato
en ese caso.

**H13. Revisar solicitudes**
Como revisor quiero ver las solicitudes enviadas, puntuarlas y añadirles notas, cada
revisor con su propia valoración, para que la decisión final se tome con criterio.

**H14. Decidir y comunicar**
Como administración quiero marcar como aceptadas las solicitudes que decidamos entre
las ya revisadas, sin que el solicitante lo vea todavía: la decisión es interna hasta
que se envía. Cuando toque comunicar, quiero poder mandar la decisión a todos los
aceptados de golpe, o enviar decisiones individuales caso a caso.

**H15. Confirmar la plaza (y qué pasa si se me pasa el plazo)**
Como aceptado quiero confirmar mi plaza desde el enlace del correo o desde la web,
dentro del plazo que se me indica. Si el plazo caduca, ya no puedo confirmar con ese
enlace: tengo que pedir a la organización que me reenvíe el correo de aceptación, y
la organización decide si me da otra oportunidad o no. Al confirmar paso a ser
participante de pleno derecho y se me emite mi entrada. Todo queda registrado: quién
confirmó, cuándo y por qué vía.

---

## 3. Equipos y proyectos

Los proyectos se entregan principalmente en Devpost, como FastTrack. hackOS importa esa
información para montar las colas de judging sin recopilar nada a mano. La base de
datos de hackOS es la fuente de verdad; cualquier importación externa solo alimenta ese
modelo y no crea una segunda verdad paralela.

**H16. Importar los proyectos de Devpost**
Como operador de colas quiero subir los dos ficheros que exporta Devpost, ver una
previsualización de lo que se va a crear (equipos, miembros, retos elegidos) y
confirmar la importación. El sistema reconoce a la gente por su correo (el de la
cuenta o el secundario de H6) y me enseña aparte a quién no supo reconocer.

**H17. Resolver personas no reconocidas**
Como operador quiero vincular manualmente a las personas que Devpost trae con un
correo que no casa con ninguna cuenta, para que nadie se quede sin su proyecto por
haberse registrado con otra dirección.

Estas dos siguientes historias quedan como extensión post-MVP, una vez la
importación de Devpost esté estable y el modelo de proyectos ya viva dentro de
hackOS.

**H18. Crear proyectos dentro de hackOS**
Como organización quiero poder crear proyectos directamente en hackOS, unirles
personas y completar toda su información — título, descripción, enlaces, retos y
demás datos — para que el sistema pueda funcionar como un clon interno de Devpost
cuando el evento ya no dependa solo de importaciones externas.

**H19. Permitir que participantes creen proyectos**
Como organización quiero poder activar, en los ajustes del evento, que los propios
participantes creen sus proyectos sin depender de Devpost, para que ese flujo quede
disponible solo cuando el evento lo decida.

**H20. Ver mi proyecto**
Como participante quiero ver mi proyecto, su equipo y a qué retos se presenta. No
puedo modificar nada de esto yo mismo: si hay que corregir algo, lo pido y lo hace la
gestión de colas o administración.

**H21. Corregir equipos y retos, incluso en caliente**
Como operador de colas quiero añadir o quitar personas de un equipo y apuntar o
retirar un equipo de un reto, también con el judging ya en marcha. Si las colas ya
están generadas, apuntar un equipo a un reto lo añade al final de la cola de ese
reto; retirarlo lo saca de la cola y el resto sube una posición. Todo auditado.

---

## 4. Acreditación, comidas y presencia

La identidad física del evento es el badge (el "papelito" con QR). La entrada
(ticket) y el badge son cosas distintas a propósito: la entrada se emite al confirmar
plaza y no se anula nunca; el badge se asigna al llegar y se puede sustituir si se
pierde, dejando el viejo desvinculado.

**H22. Acreditar a un asistente**
Como logística quiero escanear la entrada de quien llega, ver su ficha (nombre,
estado de plaza, restricciones alimenticias) y asignarle un badge, para que el
check-in sea un gesto de segundos. El lector trabaja contra una copia local ligera en
SQLite para tolerar cortes de Wi-Fi y validar el QR en local, pero no cierra el alta
sin confirmación del servidor: si no hay conexión, se espera y se reintenta en vivo
hasta recibir el OK real, para evitar que una misma acreditación se asigne dos veces.

**H23. Reponer un badge perdido**
Como logística quiero rotar el badge de alguien que lo perdió: el nuevo funciona al
momento y el viejo queda rechazado en todos los escáneres. La revocación se sincroniza
después con la API cuando vuelve la conexión.

**H24. Presencia y horas de asistencia**
Como logística quiero escanear badges en la puerta para registrar entradas y salidas
(con posibilidad de apuntar un pase manual con hora pasada si hubo un corte). Pero no
nos podemos fiar de que todo el mundo avise al salir, así que el sistema estima la
presencia combinando todos los registros: puertas, comidas y actividades. Si alguien
tiene registrada la cena pero no el desayuno, lo razonable es que haya dormido fuera;
si pasó por la comida, sabemos que como mínimo a esa hora estaba; si antes de comer
pasó por un taller, sabemos que llegó antes. Con eso el sistema estima de forma
automática cuánta gente hay en el recinto en cada momento y cuántas horas ha pasado
cada persona — que necesitamos, por ejemplo, para garantizar el mínimo de horas si se
reconocen créditos universitarios. Es normal que haya gente que no pase por ninguna
actividad y solo por las comidas; la estimación cuenta con ello.

**H25. Servir comidas**
Como miembro del staff en la cola de la comida quiero escanear el badge de cada
persona según pasa. Cada comida (el desayuno del sábado, la comida, la cena…) está
definida como una actividad por la gestión de actividades, así que el escáner sabe en
qué comida estoy. Si la persona no ha comido todavía, se registra la ración
automáticamente y me sale que es su primera vez, junto con sus restricciones
alimenticias y las notas de su perfil. Si ya tiene ración registrada, me avisa: "ojo,
esta persona ya ha comido X veces, ¿le dejas repetir?" — y lo decido yo; si le dejo,
se registra la repetición. Así sabemos cuánta gente ha comido y cuántas veces cada
una. La cola de la comida debe soportar muchos escáneres simultáneos sin perder
registros: cada escaneo se guarda en una cola local del dispositivo y no sale de ahí
hasta recibir el OK del servidor; si la red cae o el servidor se satura, queda
pendiente para reenviarse después sin duplicar ni omitir ningún pase.

**H26. Actividades registrables**
Como staff quiero escanear badges a la entrada de una charla, un taller o cualquier
actividad marcada como registrable, igual que en las comidas, para registrar quién ha
pasado por ahí. Además del interés propio de cada actividad, estos registros
alimentan la estimación de presencia de H24.

**H27. Paneles de estadísticas**
Como organización quiero distintos paneles de estadísticas según el momento del
evento. Antes del evento, mientras la gente se inscribe y se hacen los pedidos:
cuántos participantes y mentores se han inscrito y cuántos han confirmado; la
evolución temporal de inscripciones y confirmaciones (por días, incluso por horas del
día y días de la semana); cuánto tarda la gente en confirmar desde que le mandamos el
correo de aceptación; y el estado del embudo: a cuántos se les envió la decisión y
aún están en plazo, a cuántos les caducó sin confirmar, cuántos rechazaron la plaza.
También quiero poder sacar gráficos y tablas de cualquier campo del formulario (¿vas
a pedir créditos?, ¿quieres compartir tu currículum?), demografía (género, centro y
nivel de estudios) y logística: distribución de tallas de camiseta para el pedido y
distribución de restricciones alimenticias para la comida.
Ojo con las restricciones alimenticias: se piden al enviar la solicitud, pero solo
cuentan para las estadísticas las de la gente que ha confirmado plaza. Si alguien
rechaza la plaza el dato no se borra (H12) — se queda por si la organización decide
darle otra oportunidad más adelante — pero sigue sin salir en las estadísticas
mientras no confirme.

**H28. Entrada en el móvil**
Como participante quiero llevar mi entrada y mi badge en la cartera del móvil (Apple
y Google) para no depender del papel. Si me rotan el badge, el pase viejo se anula
solo. En Apple Wallet, el pase se sirve con endpoints nativos de PassKit y se empuja
la actualización cuando cambia mi estado.

---

## 5. Colas y judging

El corazón del evento y lo primero que tiene que estar estable. Cada reto tiene una
única cola; si varias salas evalúan el mismo reto, se reparten esa cola entre ellas.
Un equipo pasa por etapas físicas explícitas: **llamado** (avisado para esperar fuera
de la sala, antes se llamaba *standby*), **en sala** (dentro, pero el cronómetro no
corre aún) y **presentando** (cronómetro en marcha).

Separar "hacer pasar" de "empezar a presentar" es deliberado:
el botón único que lo arrancaba todo fue una queja reiterada de los jueces el año
pasado.

Cada reto define la cantidad de equipos que deben estar llamados a la puerta mientras
un equipo está dentro. El reto general, por ejemplo, puede decidir hacer presentaciones
de 5 minutos, por lo que tener dos o tres equipos esperando en la puerta es razonable. Un
patrocinador con menos participantes, quizá quiere dedicarle 15 minutos a cada uno, así
que tener a una persona esperando mientras otra presenta puede ser suficiente.

**H29. Llamar al siguiente equipo**
Quiero llamar al siguiente equipo de la cola para que vaya llegando mientras se termina
la presentación anterior. El equipo recibe un aviso en el móvil ("ve a esperar a la
sala X"). Hay un cupo de equipos esperando por sala, y el sistema lo rellena solo
mientras la sala está activa; puedo llamar por encima del cupo si hace falta. El
estado rápido de la sala vive en Valkey para que la actualización sea instantánea.

**H30. Nunca dos salas a la vez**
Como organización queremos la garantía dura de que jamás se llama a un equipo si
alguno de sus miembros está ya llamado, en sala o presentando en otra sala (pasa con
equipos que se presentan a varios retos). El sistema salta esa entrada y la retoma
más tarde: ejecutar "llamar al siguiente equipo" llamaría al siguiente disponible sin
que el ocupado pierda su posición en la cola.

**H31. Avisar de que entre**
Como juez quiero pulsar "que entre" y que al equipo le llegue el aviso al móvil, y a
los operadores de cola una notificación en su panel de coordinación de presentaciones
para que puedan revisar que el equipo está informado, en lugar de que alguien salga
a gritar el nombre por el pasillo.

**H32. Hacer pasar y empezar**
Como juez quiero hacer pasar al equipo (veo su proyecto, equipo y retos de un vistazo
mientras montan) y arrancar el cronómetro solo cuando de verdad empiezan a presentar.
En esa ficha aparece también la información relevante de la inscripción de cada
miembro: si el reto es "mejor proyecto rookie", por ejemplo, el panel me enseña en
qué año de carrera está cada uno.

**H33. Deshacer y casos raros**
Como juez u operador quiero poder devolver un equipo a la zona de espera (llamado) sin
que pierda su turno (demo rota, entró antes de tiempo), devolverlo a la cola, o
recuperar a un "equipo olvidado" y meterlo en cualquier cola, arriba o abajo, en
cualquier momento.

**H34. No-show con criterio humano**
Como operador quiero ver cuánto tiempo lleva llamado cada equipo, con resaltado a
partir de un umbral, y decidir yo si lo marco como no presentado.
Quien acumula llamadas fallidas va bajando en prioridad automáticamente, no queda eliminado.

Los jueces también pueden desde su vista marcar como no presente a un equipo, y
este volverá al final de la cola del reto.

Se podrá descalificar manualmente a un equipo que en reiteradas ocasiones no se
haya presentado.

**H35. Pausar una sala**
Como operador o juez quiero pausar una sala (descanso, incidencia): los equipos que
estaban llamados a esa sala vuelven a la cola con prioridad máxima (top), el que
está dentro o presentando termina normalmente, y no se llama a nadie más hasta reanudar.

**H36. Evaluar en equipo**
Como juez quiero puntuar con el formulario propio de cada reto, a la vez que mis
compañeros de sala sobre la misma ficha, viendo los cambios de los demás al momento.
Cada guardado conserva el borrador (cerrar el portátil no pierde nada) y deja rastro
de quién cambió qué y cuándo ("Innovación pasó de 7 a 9, lo cambió la jueza A a las
18:42"). Enviar cierra la presentación; se puede corregir después y queda versionado.

**H37. Buscar un equipo a mano**
Como juez quiero buscar un equipo por nombre, título o número cuando algo se sale del
guion: si aún no está evaluado, hacerlo pasar directamente (registrado como manual);
si ya lo está, abrir su evaluación existente. Nunca se crea una segunda evaluación
del mismo equipo para el mismo reto.

**H38. Seguir mi turno como participante**
Como participante quiero ver, para cada reto al que me presento, mi estado, posición
y tiempo estimado; recibir un pre-aviso cuando falten pocos minutos y un aviso claro
cuando me llamen ("ve a esperar a la sala X").

**H39. Ritmo de la sala**
Como operador quiero fijar los minutos deseados por equipo y que el sistema los
contraste con el tiempo restante y los equipos pendientes, avisando visiblemente si
no hay tiempo suficiente para dedicar esa cantidad por equipo y ajustando el ritmo.
El cronómetro cambia de color al acercarse al límite de tiempo de cada equipo.

**H40. Progreso y exportación**
Como operador de colas quiero un panel de progreso por reto (en cola, evaluados, en curso,
descalificados) y poder descargar la cola o las evaluaciones de cualquier reto en CSV
en cualquier momento, con una columna por criterio, para los sponsors que no usen el
sistema.

---

## 6. Pantallas (TV)

**H41. Pantallas de sala**
Como asistente quiero ver en las pantallas del recinto quién presenta ahora, quién
está llamado y los siguientes de cada sala, actualizado al segundo, sin que nadie
toque nada. Hay una vista general con todas las salas (que se adapta a cuántas haya)
y se alimenta por SSE nativo.

**H42. Modos de pantalla**
Como organización queremos que las pantallas puedan mostrar también el horario, las
horas que llevamos de evento, el grid de sponsors, la contraseña del wifi, un
anuncio a pantalla completa (apertura, aviso urgente)... De forma manual se selecciona
qué muestra la vista de TV de la web, para no depender de redireccionar la URL
a la que apuntan las teles durante el evento. Los cambios de modo también se propagan
por SSE.

---

## 7. Patrocinadores

**H43. Invitar a un sponsor**
Como administración quiero que, al dar de alta una empresa, se genere su enlace de
invitación; quien lo abre crea su cuenta y queda vinculado a esa empresa con los
permisos de sponsor (H9), sin altas manuales.

**H44. Editar mi empresa y mi reto**
Como sponsor quiero mantener el perfil de mi empresa (logo, web, descripción) y
editar mi reto: descripción, premios y los criterios con los que se puntuará,
construyéndolos yo mismo. Cada cambio guarda una versión, para poder saber qué decía
el reto en cualquier momento.

**H45. Revelado programado**
Como organización queremos programar cuándo se hace público cada reto ("los
patrocinadores se revelan a las 10") y que aparezca solo, a su hora, en la web y las
pantallas, sin spoilers ni botones a mano.

**H46. Mis jueces y mis resultados**
Como sponsor quiero dar de alta a mis jueces, consultar las salas que se le
han asignado a mi empresa para evaluar, y distribuir mis jueces entre esas salas, ver las
evaluaciones de mi reto y llevarme la clasificación. Si prefiero no usar el sistema
de colas, puedo decidir no usarlo, mis retos no bloquearán la llamada de ningún proyecto
en otras salas, y se me exportará un listado de proyectos con datos relevantes en un CSV
para que gestione como vea conveniente la evaluación.

---

## 8. Horario y contenido público

**H47. Horario vivo**
Como asistente quiero consultar el horario del evento en la web y el móvil, y que los
cambios de última hora se reflejen al momento en todas partes, pantallas incluidas.

**H48. Editar el horario y las actividades**
Como gestión de actividades quiero crear y editar todas las actividades del evento —
título, localización, descripción, hora de inicio y, si la tiene, hora de fin — y
decidir cuándo se hacen visibles, con publicación programada si hace falta. Aquí se
definen también las comidas y qué actividades son registrables por escáner (H25 y
H26). La lista es consultable por cualquiera y está disponible públicamente para que
otras webs (la del evento, por ejemplo) la muestren sin duplicarla a mano.

**H49. Web pública**
Como visitante quiero ver sin registrarme los retos publicados con sus premios, la
malla de empresas patrocinadoras y el horario visible.

---

## 9. Avisos y notificaciones

**H50. Anuncios**
Como organización quiero redactar un anuncio y publicarlo a la vez en pantallas,
móviles y bandeja de la app, con ventana de vigencia (aparece y desaparece solo, por
ejemplo "la cena está lista" o "quedan 30 minutos de hackeo").

**H51. Preferencias de aviso**
Como participante quiero decidir qué avisos me llegan al móvil,
correo electrónico u otros canales y apuntarme a recordatorios de
actividades concretas del horario. Los avisos operativos de mi turno
de cola no son opcionales, porque sin ellos el sistema de llamadas no funciona.

**H52. Correos que llegan**
Como organización queremos que todos los correos del sistema (verificación,
recuperación, decisiones) salgan con nuestra imagen, en el idioma de cada persona, y
que un fallo temporal del proveedor de correo no pierda ningún envío: quedan en cola
y se reintentan solos. El proveedor se elige por base de datos entre Resend, SMTP o
Postal, pero el envío siempre pasa por BullMQ.

---

## 10. Administración y auditoría

**H53. Auditoría**
Como administración quiero un registro consultable de las acciones sensibles con quién, qué,
cuándo y desde dónde, para resolver cualquier disputa con datos.

**H54. Exportaciones y datos personales**
Como administración quiero exportar los datos operativos (evaluaciones, asistencia,
colas) y poder atender una solicitud de exportación o borrado de datos personales de
cualquier usuario.

---

## 11. Móvil

**H55. Una sola app**
Como usuario quiero una única app en la que cada cual ve lo suyo: el participante, su
horario, sus turnos de cola y sus pases; el staff, además, los escáneres que le
correspondan según sus permisos. Al cambiar los permisos de alguien, sus pestañas
cambian sin reinstalar nada. La app usa las sesiones de Better Auth para Expo y las
notificaciones operativas llegan por Expo Push Notifications.

---

## Orden de desarrollo propuesto

El bloque de colas es innegociable. FastTrack tiene que mejorar, el resto es opcional.

1. **Cuenta, identidad y permisos** (sección 1)
2. **Colas, judging y pantallas** (secciones 5 y 6)
3. **Inscripción** (sección 2) y **equipos/Devpost** (sección 3) pueden avanzar en
   paralelo con lo anterior.
4. **Acreditación y logística** (sección 4) y **contenido público y horario**
   (sección 8).
5. **Sponsors** (sección 7), que depende de las invitaciones de empresa (H9) y de que
   exista el judging.
6. **Notificaciones completas** (sección 9)
7. **Móvil** (sección 11) y **pases de cartera** (H28), al final, sobre lo ya
   estable.