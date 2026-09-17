# Variables de entorno del runtime multi-arquitectura

Staging en la Raspberry Pi y producción en el LXC `hackos` usan
[`deploy/docker-compose.yml`](../deploy/docker-compose.yml) como una única
aplicación Compose. El contrato canónico recibe primero un fichero de
configuración y después uno de secretos:

```sh
docker compose \
  --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml config
```

El segundo fichero tiene precedencia. Ninguno de los dos se copia a las
imágenes. [`deploy/.env.example`](../deploy/.env.example) sólo contiene
configuración no secreta. Por compatibilidad con el LXC preparado localmente,
`check-env.sh` y el despliegue aceptan un único `/etc/hackos/hackos.env` con
permisos `0600`; no es una segunda plantilla ni sustituye al contrato canónico.
El despliegue no busca `.env` ni `.env.<environment>` dentro de `/opt/hackos`.

La plantilla no secreta está en
[`deploy/.env.example`](../deploy/.env.example) y la plantilla de nombres de
secretos en [`deploy/.env.secrets.example`](../deploy/.env.secrets.example).
Los valores reales se generan y cargan fuera del repositorio. El fichero raíz
[`.env.example`](../.env.example) es sólo para overrides del API local y
[`apps/mobile/.env.example`](../apps/mobile/.env.example) contiene únicamente
valores públicos compilados en la app móvil.

## Reglas del contrato

| Variable | Ubicación | Obligatoria | Uso |
|---|---|---:|---|
| `IMAGE_TAG` | configuración | sí | Tag inmutable de las imágenes de aplicación. Debe coincidir con `sha-` seguido de 40 caracteres hexadecimales en minúscula. |
| `API_DOMAIN` | configuración | sí | Hostname público del API, sin esquema. Se convierte en `https://...` para Better Auth y el runtime web. |
| `WEB_DOMAIN` | configuración | sí | Hostname público del frontend, sin esquema. |
| `CORS_ORIGINS` | configuración | sí | Lista separada por comas; debe incluir `https://${WEB_DOMAIN}`. |
| `PUBLISH_BIND_ADDRESS` | configuración | no | Dirección de publicación HTTP; `0.0.0.0` para el proxy de otro LXC y `127.0.0.1` si comparte host. |
| `API_PUBLISH_PORT`, `WEB_PUBLISH_PORT` | configuración | no | Puertos del host para API y web; por defecto `3000` y `3001`. |
| `HACKOS_DATA_DIR` | configuración | no | Ruta absoluta al volumen persistente; por defecto `/mnt/data`, con `postgres/` y `minio/` debajo. |
| `POSTGRES_USER`, `POSTGRES_DB` | configuración | sí | Identidad y base inicial de PostgreSQL; no son secretos. |
| `MINIO_ROOT_USER`, `S3_ACCESS_KEY` | configuración | sí | Identificador administrativo de MinIO y nombre de la cuenta de aplicación; sus contraseñas pertenecen al fichero de secretos. |
| `S3_BUCKET` | configuración | no | Bucket creado por `minio-init`, por defecto `hackos`. |
| `S3_REGION` | configuración | no | Región S3 para el cliente SDK; por defecto `us-east-1`. |
| `S3_PUBLIC_URL` | configuración | sí en producción | URL HTTPS pública de objetos; en producción es `https://s3.hackudc.com/hackos/`. El endpoint lo sirve el ingress S3 externo; Compose no publica MinIO. |
| `R2_BACKUPS_ENABLED` | configuración | no | `false` por defecto; con `true`, el despliegue ejecuta `backup-r2.sh` antes de `migrate`. |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_PREFIX` | configuración | si R2 está activo | Endpoint S3-compatible HTTPS, bucket privado y prefijo para las copias. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secreto | si R2 está activo | Credenciales del token R2 limitado al bucket; nunca se pasan a `api`, `worker` ni `web`. |
| `MAIL_PROVIDER` | configuración | no | `smtp`; el transporte se mantiene explícito para el despliegue. |
| `MAIL_FROM_ADDRESS` | configuración | sí | Remitente de los correos. |
| `MAIL_FROM_NAME` | configuración | no | Nombre del remitente, por defecto `hackOS`. |
| `SMTP_HOST`, `SMTP_PORT` | configuración | sí para SMTP | Host y puerto del relay SMTP. `SMTP_PORT` vale `587` por defecto; Amazon SES se configura aquí mediante su interfaz SMTP. |
| `SMTP_USER`, `SMTP_PASS` | secreto | no | Credenciales opcionales del relay SMTP; se dejan vacías si el relay no autentica. |
| `MOBILE_APP_SCHEME` | configuración | no | Esquema de la app móvil, por defecto `hackos`. |

El script [`deploy/scripts/check-env.sh`](../deploy/scripts/check-env.sh)
valida estos valores, evita tags mutables y comprueba los bloques de correo y
Wallet sin imprimir secretos.

### Variables derivadas o fijadas por Compose

Estas variables pertenecen al esquema del API, pero no se escriben en los
ficheros de producción porque Compose las fija o las construye desde el
contrato anterior:

| Variable | Valor en producción | Motivo |
|---|---|---|
| `NODE_ENV` | `production` | Fijado en `api`, `worker` y `migrate`. |
| `WORKERS_INLINE` | `false` | El worker corre en su propio contenedor. |
| `TRUST_PROXY` | `true` | Caddy termina TLS y reenvía la IP del cliente. |
| `DATABASE_URL` | `postgres://...@postgres:5432/...` | Construida por Compose; no se duplica en los ficheros. |
| `VALKEY_URL` | `redis://...@valkey:6379` | Construida por Compose; contiene el secreto de Valkey. |
| `BETTER_AUTH_URL` | `https://${API_DOMAIN}` | Derivada del hostname público del API. |
| `WEB_URL` | `https://${WEB_DOMAIN}` | Derivada del hostname público del frontend. |
| `S3_ENDPOINT` | `http://minio:9000` | Ruta privada del servicio S3 dentro de Compose. |
| `HOST` | `0.0.0.0` | Default interno del API; no modifica el puerto publicado. |
| `PORT` | `3000` | Puerto interno fijo del contenedor API. |

`HOST` y `PORT` siguen documentadas aquí porque forman parte del esquema de
configuración del API, aunque no son variables del contrato operativo del LXC.

## Variables por proceso

La tabla muestra las variables que terminan dentro de cada contenedor. Las
variables agrupadas se detallan en las secciones siguientes.

| Servicio | Variables |
|---|---|
| `postgres` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| `valkey` | `VALKEY_PASSWORD` |
| `minio` | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BROWSER=off` |
| `minio-init` | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` |
| `migrate` | `NODE_ENV=production`, `DATABASE_URL`, `BETTER_AUTH_SECRET` |
| `api` | `NODE_ENV`, `WORKERS_INLINE`, `DATABASE_URL`, `VALKEY_URL`, auth, URLs públicas, almacenamiento, Wallet, traducción, observabilidad, límites operativos y fixtures API-only |
| `worker` | `NODE_ENV`, `WORKERS_INLINE`, `DATABASE_URL`, `VALKEY_URL`, auth/URLs para enlaces, almacenamiento, Wallet, correo y tuning del worker |
| `web` | `API_DOMAIN`, `WEB_DOMAIN` |

`DATABASE_URL` y `VALKEY_URL` se ensamblan dentro de Compose a partir de las
credenciales del fichero de secretos. El puerto del API (`3000`) y el del web
(`3001`) están fijados por las imágenes y no son variables de este contrato.
Las variables R2 sólo las consume el helper de backup en el host; no aparecen
en ningún contenedor de aplicación.

### Base de datos, Valkey y almacenamiento

| Variable | Procesos | Notas |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `postgres`; Compose para `api`, `worker`, `migrate` | Identidad, contraseña y destino de la base; el usuario y la base están en configuración, la contraseña en secretos, y se convierten en `DATABASE_URL`. |
| `VALKEY_PASSWORD` | `valkey`; Compose para `api`, `worker` | Se usa en `VALKEY_URL=redis://:<password>@valkey:6379`. Valkey no persiste datos. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | `minio-init`, `api`, `worker` | El identificador está en configuración y la clave en secretos; `minio-init` crea la cuenta de servicio y la limita al bucket. No es la cuenta root de MinIO. |
| `S3_ENDPOINT` | `api`, `worker` | Fijo en `http://minio:9000`; no debe cambiarse por `s3.hackudc.com`. |
| `S3_REGION` | `api`, `worker` | Región lógica del cliente S3; `us-east-1` funciona con MinIO. |
| `S3_BUCKET` | `api`, `worker`, `minio-init` | Debe ser el mismo bucket en los tres procesos; por defecto `hackos`. |
| `S3_PUBLIC_URL` | `api`, `worker` | `https://s3.hackudc.com/hackos/`; sólo se usa para URLs de logos públicos. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | `minio`, `minio-init` | Administración de MinIO; no se entrega a API, worker ni web. |

### Bucket público de MinIO y `s3.hackudc.com`

En producción, el API guarda los objetos en el MinIO privado mediante
`S3_ENDPOINT=http://minio:9000` y devuelve URLs públicas con
`S3_PUBLIC_URL=https://s3.hackudc.com/hackos/`. Por tanto, un logo con clave
`enterprises/42/logo-default.png` se sirve en:

```text
https://s3.hackudc.com/hackos/enterprises/42/logo-default.png
```

`minio-init` permite lectura anónima sólo bajo `enterprises/`, que contiene
logos públicos. `uploads/` permanece privado y sólo se descarga mediante el
API autorizado. No se debe convertir todo el bucket en anónimo porque eso
expondría ficheros de solicitudes.

El ingress externo debe publicar únicamente la API S3 de MinIO para
`s3.hackudc.com`; la consola de MinIO no se publica. Conceptualmente, Caddy
debe hacer:

```caddyfile
s3.hackudc.com {
    reverse_proxy <endpoint-de-la-api-s3-de-minio-alcanzable-desde-caddy>:9000
}
```

El Compose actual mantiene MinIO sin `ports:`. `S3_PUBLIC_URL` no crea por sí
solo esa ruta: si Caddy está en otro LXC, la integración de infraestructura
debe proporcionar un camino privado/revisado hasta la API S3 de MinIO. Hasta
que exista ese routeo y DNS, las URLs de logos serán correctas pero no
alcanzables desde el navegador. Esta habilitación queda fuera de este
repositorio para respetar la regla de no modificar `gpul/infra`.

### API

Además de las variables de las dependencias anteriores, `api` recibe:

| Grupo | Variables |
|---|---|
| Auth y origen | `BETTER_AUTH_URL`, `WEB_URL`, `BETTER_AUTH_SECRET`, `MOBILE_APP_SCHEME`, `CORS_ORIGINS`, `TRUST_PROXY=true` |
| Base del proceso | `NODE_ENV=production`, `WORKERS_INLINE=false`, `LOG_LEVEL` |
| Pool PostgreSQL | `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` |
| SSE | `SSE_MAX_CONNECTIONS_GLOBAL`, `SSE_MAX_CONNECTIONS_PER_TOPIC`, `SSE_MAX_CONNECTIONS_PER_CLIENT`, `SSE_WRITE_TIMEOUT_MS` |
| Scanners | `RATE_LIMIT_SCAN_MAX`, `RATE_LIMIT_SCAN_WINDOW_SECONDS`, `RATE_LIMIT_MEAL_BATCH_MAX`, `RATE_LIMIT_MEAL_BATCH_WINDOW_SECONDS`, `RATE_LIMIT_SNAPSHOT_MAX`, `RATE_LIMIT_SNAPSHOT_WINDOW_SECONDS` |
| Push | `LOG_EXPO_PUSH_TICKETS`, `LOG_EXPO_PUSH_TOKENS`, `LOG_EXPO_PUSH_UNSAFE_DEBUG` |
| Traducción | `TRANSLATE_PROVIDER`, `GOOGLE_TRANSLATE_API_KEY`, `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` |
| Wallet | `APPLE_PASS_TYPE_IDENTIFIER`, `APPLE_TEAM_IDENTIFIER`, `APPLE_PASS_ORGANIZATION`, `APPLE_PASS_CERTIFICATE_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_PASS_KEY_PASSPHRASE`, `APPLE_WWDR_CERTIFICATE_PEM`, `APPLE_APNS_ENVIRONMENT`, `APPLE_PASS_APP_STORE_ID`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_EVENT_TICKET_CLASS_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_WALLET_PRIVATE_KEY_PEM`, `GOOGLE_WALLET_LOGO_URL`, `GOOGLE_WALLET_HERO_IMAGE_URL`, `GOOGLE_WALLET_WIDE_LOGO_URL`, `GOOGLE_WALLET_BACKGROUND_COLOR` |
| Fixtures | `REVIEW_FIXTURE_PASSWORD`, `REVIEW_FIXTURE_DELETION_PIN` |

El API no recibe variables de correo ni la cuenta root de MinIO.

### Worker

`worker` recibe, además de base de datos, Valkey, auth, URLs y almacenamiento:

| Grupo | Variables |
|---|---|
| Proceso | `NODE_ENV=production`, `WORKERS_INLINE=false`, `LOG_LEVEL`, `LOG_EXPO_PUSH_TICKETS`, `LOG_EXPO_PUSH_UNSAFE_DEBUG` |
| Pool y outbox | `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `NOTIFICATION_OUTBOX_BATCH_SIZE` |
| Correo | `MAIL_PROVIDER`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| Wallet | El mismo bloque de Wallet que usa API, porque el worker empuja sincronizaciones de pases. |

El worker no recibe `CORS_ORIGINS`, límites SSE, rate limits de scanner,
fixtures ni credenciales de administración de MinIO.

## Qualification pre-evento y presupuesto

La qualification es un stack desechable de carga previa al evento. Usa una base
de datos y Valkey aislados, cuentas sintéticas y una red interna sin ingress;
se destruye después de recuperar el resultado. No reutiliza ningún servicio,
volumen, secreto o estado de producción. Sus límites de `postgres`, `valkey`,
`api` y `worker` deben ser exactamente los de producción para que
`validation.releaseBudgetPassed` sea una señal significativa. El runner es un
arnés de prueba independiente y `migrate` es un helper one-shot: ambos tienen
límites propios, pero el conjunto sigue bajo el presupuesto de memoria de
producción.

La carga por defecto representa 600 participantes, 35 personas de staff, 30
representantes de sponsors, 12 salas y 7 colas, con 3 colas compartidas. El
pool base es `DB_POOL_MAX=24` por proceso. Con una API y un worker, el cálculo
de conexiones es `(1 × 24) + (1 × 24) + 12 operativas = 60`, por debajo de
`max_connections=100`; las 12 conexiones operativas cubren migración,
mantenimiento, administración y superusuario.

### Migrate y web

`migrate` es un proceso one-shot: sólo necesita `DATABASE_URL` y
`BETTER_AUTH_SECRET` para ejecutar la cadena SQL y sus comprobaciones de
compatibilidad. No recibe Valkey, S3, correo, Wallet ni configuración web.

`web` sólo recibe `API_DOMAIN` y `WEB_DOMAIN`, que el servidor Next.js expone
en `/runtime-config.js`. No recibe ninguna variable secreta ni dependencias de
datos.

## Secretos opcionales del relay SMTP

- `SMTP_HOST` es obligatorio para el transporte SMTP; `SMTP_USER` y
  `SMTP_PASS` sólo si el relay autentica.
- Apple Wallet: `APPLE_PASS_CERTIFICATE_PEM`, `APPLE_PASS_KEY_PEM` y
  `APPLE_WWDR_CERTIFICATE_PEM` deben estar todos presentes o todos ausentes.
- Google Wallet: `GOOGLE_WALLET_ISSUER_ID`,
  `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` y
  `GOOGLE_WALLET_PRIVATE_KEY_PEM` deben estar todos presentes o todos ausentes.

Los valores PEM se guardan como base64 en el fichero de secretos. Nunca se
bakean en una imagen ni se añaden al repositorio.

## Backups R2

Cuando `R2_BACKUPS_ENABLED=true`, el helper exige un endpoint `https://`, un
bucket y prefijo válidos, y las dos credenciales R2. Crea un dump custom de
PostgreSQL, replica el bucket MinIO y escribe un manifiesto bajo
`R2_PREFIX/<environment>/<timestamp>/`. El token debe limitarse al bucket de
backups y el bucket debe tener una política de retención configurada fuera del
repositorio. La ejecución automática periódica en el LXC es una habilitación
operativa manual.

## Valores fijos deliberados

No existen variables para cambiar los repositorios de imágenes: son
`ghcr.io/danicallero/hackos-api` y `ghcr.io/danicallero/hackos-web`. Tampoco se
exponen variables de memoria. Los límites actuales están fijados en Compose:

| Servicio | Memoria |
|---|---:|
| `postgres` | `2g` |
| `valkey` | `1g` |
| `minio` | `1g` |
| `api` | `1g` |
| `worker` | `1g` |
| `web` | `512m` |

La suma declarada es `6.5 GiB` (`2 + 1 + 1 + 1 + 1 + 0.5`) y deja margen
dentro del presupuesto de memoria de producción para el sistema operativo,
Docker y presión operativa breve. Los límites no se cambian mediante variables
de entorno. Para cambiar uno, edita el Compose, recrea el servicio y comprueba
su salud:

```sh
# editar deploy/docker-compose.yml y la qualification si el servicio se refleja allí
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml up -d --force-recreate <service>
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml ps <service>
```

Después vuelve a ejecutar `deploy/qualification/validate-compose.mjs` y la
qualification completa antes de desplegar el cambio.

### Árbol de decisión de `DB_POOL_MAX`

El baseline operativo es 24; usa estas señales para decidir:

1. P2/P3 `429` o profundidad de espera alta con conexiones Postgres, latencia
   P0/P1 y memoria sanas: conserva 24 si es tráfico best-effort; si hace falta
   más throughput finito, sube el pool sólo tras recalcular conexiones y
   repetir qualification.
2. Conexiones cerca de 88, `hackos_db_pool_waiting`/lock waits en aumento:
   no subas el pool; reduce el burst, encuentra la consulta/bloqueo o revisa la
   topología.
3. OOM de Postgres: reduce pool o concurrencia y rehace el presupuesto de
   memoria antes de tocar `max_connections`.
4. Espera P0/P1 mientras P2/P3 se degrada: conserva 24 y revisa el camino
   prioritario. El scheduler reserva 6 slots concurrentes para proteger de
   todo tráfico P2/P3, incluso usuarios autenticados, y limita su cola a
   `max(16, 24 × 8) = 192`; no es una reserva de un slot por persona de staff
   ni preempción de peticiones activas.

La red `private`, la red de salida `egress`, sus alias de servicio y las rutas
internas de Postgres, Valkey y MinIO también son parte fija del contrato. Sólo
API y web publican los puertos configurables para el proxy de ingress.
PostgreSQL y MinIO usan bind mounts bajo `HACKOS_DATA_DIR`; Valkey no tiene
persistencia deliberada.

## CD con Incus

El workflow de build publica las dos imágenes en GHCR para `linux/amd64` y
`linux/arm64`, únicamente con `sha-<commit>`. El workflow de deploy sólo
acepta un tag SHA completo y lo inyecta como `IMAGE_TAG`; nunca usa `latest` ni
tags de rama mutables.

`deploy-incus.yml` corre mediante `workflow_dispatch` en los environments
protegidos `production` y `staging`, sobre un runner self-hosted con
Incus local. El runner no se habilita desde este repositorio: el bloque
`setup-gh-runner` del repositorio de infraestructura está actualmente
comentado y debe habilitarse/registrarse como dependencia previa; este cambio
no modifica ese repositorio.

Actions sólo transfiere el Compose y scripts a `/opt/hackos` con Incus. No
recibe secretos de aplicación, no descifra SOPS y no usa Docker Remote API. El
script dentro del LXC lee la pareja canónica o el fichero combinado compatible,
toma un lock, valida sin imprimir valores, hace pull de imágenes fijadas,
ejecuta el backup R2 opt-in, ejecuta migraciones y espera healthchecks. Para
rollback se vuelve a lanzar el workflow con el tag SHA anterior; el workflow
selecciona también el commit asociado al tag y conserva una copia de scripts y
Compose por release. Cambiar imágenes no revierte automáticamente las
migraciones de la base de datos.
