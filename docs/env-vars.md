# Variables de entorno del runtime ARM64

Staging en la Raspberry Pi y producción en el LXC `hackos` de GPULux usan
[`deploy/docker-compose.yml`](../deploy/docker-compose.yml) como una única
aplicación Compose. Compose recibe primero un fichero de configuración y
después uno de secretos:

```sh
docker compose \
  --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml config
```

El segundo fichero tiene precedencia. Ninguno de los dos se copia a las
imágenes. [`deploy/.env.example`](../deploy/.env.example) sólo contiene
configuración no secreta.

## Reglas del contrato

| Variable | Ubicación | Obligatoria | Uso |
|---|---|---:|---|
| `IMAGE_TAG` | configuración | sí | Tag inmutable de las imágenes de aplicación. Debe coincidir con `sha-` seguido de 40 caracteres hexadecimales en minúscula. |
| `API_DOMAIN` | configuración | sí | Hostname público del API, sin esquema. Se convierte en `https://...` para Better Auth y el runtime web. |
| `WEB_DOMAIN` | configuración | sí | Hostname público del frontend, sin esquema. |
| `CORS_ORIGINS` | configuración | sí | Lista separada por comas; debe incluir `https://${WEB_DOMAIN}`. |
| `COMPOSE_PROJECT_NAME` | Compose | no | Nombre del proyecto Compose; en GPULux se recomienda `hackos`. |
| `S3_BUCKET` | configuración | no | Bucket creado por `minio-init`, por defecto `hackos`. |
| `S3_PUBLIC_URL` | configuración | no | URL HTTPS externa y accesible por navegador para logos públicos. MinIO no publica un puerto. |
| `MAIL_PROVIDER` | configuración | no | `smtp`, `resend` o `postal`; por defecto `smtp`. |
| `MAIL_FROM_ADDRESS` | configuración | sí | Remitente de los correos. |
| `MAIL_FROM_NAME` | configuración | no | Nombre del remitente, por defecto `hackOS`. |
| `SMTP_HOST`, `SMTP_PORT` | configuración | si `smtp` | Host y puerto del relay SMTP. `SMTP_PORT` vale `587` por defecto. |
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

### Base de datos, Valkey y almacenamiento

| Variable | Procesos | Notas |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `postgres`; Compose para `api`, `worker`, `migrate` | Credenciales y destino de la base; se convierten en `DATABASE_URL`. |
| `VALKEY_PASSWORD` | `valkey`; Compose para `api`, `worker` | Se usa en `VALKEY_URL=redis://:<password>@valkey:6379`. Valkey no persiste datos. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | `minio-init`, `api`, `worker` | `minio-init` crea la cuenta de servicio y la limita al bucket; API y worker la usan después. No es la cuenta root de MinIO. |
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

El API no recibe variables SMTP, Resend, Postal ni la cuenta root de MinIO.

### Worker

`worker` recibe, además de base de datos, Valkey, auth, URLs y almacenamiento:

| Grupo | Variables |
|---|---|
| Proceso | `NODE_ENV=production`, `WORKERS_INLINE=false`, `LOG_LEVEL`, `LOG_EXPO_PUSH_TICKETS`, `LOG_EXPO_PUSH_UNSAFE_DEBUG` |
| Pool y outbox | `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `NOTIFICATION_OUTBOX_BATCH_SIZE` |
| Correo | `MAIL_PROVIDER`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `MAIL_FOOTER_TEXT`, `MAIL_LAYOUT_*`, `RESEND_API_KEY`, `POSTAL_URL`, `POSTAL_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
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

## Secretos opcionales por proveedor

- SMTP: `SMTP_HOST` es obligatorio para el provider SMTP; `SMTP_USER` y
  `SMTP_PASS` sólo si el relay autentica.
- Resend: `RESEND_API_KEY` es obligatorio.
- Postal: `POSTAL_URL` y `POSTAL_API_KEY` son obligatorios.
- Apple Wallet: `APPLE_PASS_CERTIFICATE_PEM`, `APPLE_PASS_KEY_PEM` y
  `APPLE_WWDR_CERTIFICATE_PEM` deben estar todos presentes o todos ausentes.
- Google Wallet: `GOOGLE_WALLET_ISSUER_ID`,
  `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` y
  `GOOGLE_WALLET_PRIVATE_KEY_PEM` deben estar todos presentes o todos ausentes.

Los valores PEM se guardan como base64 en el fichero de secretos. Nunca se
bakean en una imagen ni se añaden al repositorio.

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

La red `private`, sus alias de servicio y las rutas internas de Postgres,
Valkey y MinIO también son parte fija del contrato. Sólo API y web publican
loopback para Caddy.
