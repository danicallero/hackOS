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
| `S3_PUBLIC_URL` | configuración | no | URL HTTPS externa y accesible por navegador para logos públicos. MinIO no publica un puerto. |
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
| `S3_ENDPOINT` | `api`, `worker` | Fijo en `http://minio:9000`. |
| `S3_BUCKET` | `api`, `worker`, `minio-init` | Debe ser el mismo bucket en los tres procesos; por defecto `hackos`. |
| `S3_PUBLIC_URL` | `api`, `worker` | Opcional; sólo afecta a URLs públicas de logos. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | `minio`, `minio-init` | Administración de MinIO; no se entrega a API, worker ni web. |

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
| `postgres` | `1g` |
| `valkey` | `512m` |
| `minio` | `1g` |
| `api` | `512m` |
| `worker` | `512m` |
| `web` | `256m` |

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
