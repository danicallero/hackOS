# Despliegue multi-arquitectura de hackOS

Este directorio contiene un único runtime de Docker Compose para un host ARM64
de staging y un host Linux/x86_64 de producción. El build publica
`linux/amd64` y `linux/arm64`; los hosts sólo
descargan imágenes y nunca compilan el repositorio durante el despliegue.

La definición canónica es [`docker-compose.yml`](./docker-compose.yml). El
stack tiene estos servicios de runtime:

- `postgres`: estado durable de hackOS.
- `valkey`: BullMQ, SSE y contadores efímeros.
- `minio`: almacenamiento S3-compatible durable.
- `migrate`: proceso explícito one-shot de migraciones.
- `api`: Fastify en el puerto interno `3000`.
- `worker`: BullMQ en proceso separado, sin HTTP.
- `web`: Next.js en el puerto interno `3001`.

`minio-init` es un helper one-shot del mismo Compose para crear el bucket, la
cuenta de servicio y la política de logos. No es un servicio de aplicación y
no recibe variables propias del API.

## Red e ingress

Compose crea la red bridge interna `private` y una red de salida `egress`. Los
servicios de estado PostgreSQL y Valkey sólo están en `private`; MinIO usa
`private` y puede unirse al ingress opcional para servir la API S3. API y worker
usan las redes necesarias para resolver (`postgres:5432`, `valkey:6379`,
`minio:9000`) y acceder a proveedores externos. `web` sólo necesita `egress`.
Por defecto todas las redes son del proyecto; el perfil opcional de ingress
compartido se describe más abajo.

Sólo se publican dos puertos HTTP del host. En producción el proxy está en otro LXC,
por lo que la configuración canónica usa `0.0.0.0`; si el proxy comparte host,
se puede fijar `PUBLISH_BIND_ADDRESS=127.0.0.1`.

| Servicio | Puerto del contenedor | Publicación | Uso |
|---|---:|---|---|
| `api` | `3000` | `${PUBLISH_BIND_ADDRESS}:${API_PUBLISH_PORT}:3000` | Proxy → HTTP + SSE |
| `web` | `3001` | `${PUBLISH_BIND_ADDRESS}:${WEB_PUBLISH_PORT}:3001` | Proxy → Next.js |

PostgreSQL, Valkey y MinIO no tienen `ports:`. Su consola MinIO también queda
apagada. Caddy termina TLS y puede usar, por ejemplo, la IP Incus del LXC
`hackos`:

```caddyfile
api.example.org {
    reverse_proxy <ip-incus-del-lxc-hackos>:3000
}

example.org {
    reverse_proxy <ip-incus-del-lxc-hackos>:3001
}

# S3_PUBLIC_URL=https://s3.example.org/hackos/
s3.example.org {
    reverse_proxy <endpoint-de-la-api-s3-de-minio-alcanzable-desde-caddy>:9000
}
```

La tercera ruta sólo puede apuntar a la API S3 de MinIO, nunca a la consola
(9001). El Compose mantiene MinIO sin puerto de host; por ello, si Caddy vive
en otro LXC, infraestructura debe habilitar el camino privado/revisado hasta
`minio:9000` antes del primer despliegue. `S3_PUBLIC_URL` no abre ese camino.
El acceso anónimo se limita al prefijo `enterprises/`; las subidas bajo
`uploads/` siguen siendo privadas y pasan por el API.

Los valores de `API_DOMAIN`, `WEB_DOMAIN` y `CORS_ORIGINS` deben corresponder
con esos hosts. `API_DOMAIN` y `WEB_DOMAIN` son nombres sin `https://`.

### Optional shared ingress network

The normal profile uses a Compose-owned `edge` network and the external proxy
reaches the published HTTP ports. A staging host that already has a host-level
tunnel or proxy can instead set `EDGE_NETWORK_NAME` to its existing Docker
network and `EDGE_NETWORK_EXTERNAL=true`. `api` and `web` join that network
with the stable aliases `api` and `web`; MinIO also joins it so an explicitly
configured `s3` hostname can route to the S3 API at `minio:9000`. PostgreSQL
and Valkey remain private. This lets a tunnel whose origins are Docker service
names survive an application cutover while keeping the database and queue
store off the ingress network.

Do not enable this option against an unreviewed shared network. Before the
cutover, stop the previous API and web containers so the aliases cannot resolve
to two releases at once. Keep the tunnel/proxy service running while the new
containers are recreated.

## Configuración y secretos

Cada host mantiene dos ficheros planos fuera del repositorio:

| Fichero | Contenido | Plantilla |
|---|---|---|
| `/etc/hackos/hackos.env` | Sólo configuración no secreta: imagen, dominios, puertos, nombres de cuentas, S3 público, correo, logs, R2 y metadatos Wallet. | [`deploy/.env.example`](./.env.example) |
| `/etc/hackos/hackos.secrets` | Sólo credenciales y material privado: contraseñas, claves S3/R2/SMTP, `BETTER_AUTH_SECRET`, claves de traducción, fixtures y PEM Wallet. Permisos `0600`. | [`deploy/.secrets.example`](./.secrets.example) |

No se permite duplicar una clave entre los dos ficheros. La plantilla de
secretos contiene nombres y valores vacíos; nunca se usa como fichero real ni
se copia al repositorio.

El contrato canónico es siempre esta pareja. El despliegue acepta además, de
forma explícita y temporal, un único `/etc/hackos/hackos.env` con permisos
`0600`: es la compatibilidad necesaria para el LXC preparado localmente. No se
acepta un fichero de secretos sin configuración, no busca `.env` junto al
Compose y no se mantienen plantillas duplicadas por instancia.

Docker Compose acepta varios `--env-file`; el segundo tiene precedencia:

```sh
CONFIG=/etc/hackos/hackos.env
SECRETS=/etc/hackos/hackos.secrets
COMPOSE="docker compose --env-file $CONFIG --env-file $SECRETS -f deploy/docker-compose.yml"

./deploy/scripts/check-env.sh "$CONFIG" "$SECRETS"
$COMPOSE config >/dev/null
```

El fichero de secretos debe contener, como mínimo, estas claves:

```text
POSTGRES_PASSWORD
VALKEY_PASSWORD
MINIO_ROOT_PASSWORD
BETTER_AUTH_SECRET
S3_SECRET_KEY
```

`POSTGRES_USER`, `POSTGRES_DB`, `MINIO_ROOT_USER` y `S3_ACCESS_KEY` son
identificadores de configuración y viven en `hackos.env`; no se generan ni se
guardan como secretos. `S3_SECRET_KEY` sí permanece en `hackos.secrets`.

Para correo, `MAIL_PROVIDER=smtp` requiere `SMTP_HOST`. En producción se puede
usar Amazon SES a través de su endpoint SMTP; `SMTP_USER` y `SMTP_PASS` se
guardan en el fichero de secretos cuando el relay requiere autenticación. Las
claves de firma de Apple/Google son opcionales, pero cada bloque configurado
debe estar completo. `check-env.sh` no imprime valores secretos.

Los backups opcionales de Cloudflare R2 usan `R2_ENDPOINT`, `R2_BUCKET` y
`R2_PREFIX` en la configuración, y `R2_ACCESS_KEY_ID`/
`R2_SECRET_ACCESS_KEY` en el fichero de secretos. El helper exige
`R2_BACKUPS_ENABLED=true` antes de transmitir nada.

La pareja `MINIO_ROOT_*` sólo se entrega a `minio` y `minio-init`. El helper
`minio-init` usa además `S3_ACCESS_KEY`/`S3_SECRET_KEY` para crear, de forma
idempotente, la cuenta de aplicación y una política limitada al bucket. Esas
credenciales S3 sólo se entregan después a `api` y `worker`; nunca son la
cuenta root de MinIO ni llegan a `web` o `migrate`.

### Safely changing environment values

The operator shell never prints environment values. Use `sudoedit`, validate,
then explicitly recreate affected services:

```sh
sudoedit /etc/hackos/hackos.env
sudoedit /etc/hackos/hackos.secrets
/opt/hackos/check-env.sh /etc/hackos/hackos.env /etc/hackos/hackos.secrets
```

For the temporary combined-file layout, edit and validate that one `0600` file
instead. `check-env.sh` validates keys, domains, tags, credential blocks, and
permissions without printing secret values:

```sh
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f /opt/hackos/docker-compose.yml \
  up -d --no-build --force-recreate --wait --wait-timeout 120 api worker web
```

Never put a secret in a command, CI log, Compose output, or repository file.
The secret editor remains an explicit host-permission operation.

## Variables por servicio

La siguiente matriz es deliberada: no se pasa el entorno completo a cada
contenedor.

| Servicio | Variables que recibe |
|---|---|
| `postgres` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| `valkey` | `VALKEY_PASSWORD` |
| `minio` | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BROWSER=off` |
| `minio-init` | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` |
| `migrate` | `NODE_ENV`, `DATABASE_URL`, `BETTER_AUTH_SECRET` |
| `api` | base de datos, Valkey, auth, URLs públicas, almacenamiento, Wallet, traducción, SSE, rate limits y fixtures API-only |
| `worker` | base de datos, Valkey, auth/URLs necesarias para enlaces, almacenamiento, correo, Wallet y tuning del worker |
| `web` | sólo `API_DOMAIN` y `WEB_DOMAIN` |

En particular, `web` nunca recibe secretos; `api` no recibe credenciales de
correo; y `migrate` no recibe Valkey, S3, correo ni Wallet.

## Imágenes y límites

Las imágenes de aplicación son referencias fijas y completas de GHCR:

```text
ghcr.io/danicallero/hackos-api:${API_IMAGE_TAG}
ghcr.io/danicallero/hackos-web:${WEB_IMAGE_TAG}
```

`IMAGE_TAG` es el tag SHA del commit de release y debe ser exactamente
`sha-<40 caracteres hexadecimales en minúscula>`. El script de despliegue lo
usa como tag de la unidad modificada y exporta `API_IMAGE_TAG` y
`WEB_IMAGE_TAG` para que la otra conserve su release anterior. No se acepta
`latest`, un tag de rama ni una referencia de repositorio configurable. El
workflow de CD publica sólo los tags SHA de las imágenes que cambiaron; el
servidor sólo hace pull.

Las imágenes de infraestructura están fijadas por digest de índice
multi-arquitectura en el Compose y no se modifican en el servidor:

```text
postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
valkey/valkey@sha256:d2e18f3410b6f616de1417f570fa55261af2898b9c5b2cfb6781ce2373ea43d1
quay.io/minio/minio@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e
quay.io/minio/mc@sha256:aead63c77f9db9107f1696fb08ecb0faeda23729cde94b0f663edf4fe09728e3
```

Las imágenes de aplicación son las de GHCR; las de infraestructura conservan
sus registros oficiales, pero todas quedan inmutables por digest.

Los límites de memoria del evento se mantienen como literales, sin variables de
override. La suma de los seis servicios persistentes/de larga duración es
`2 + 1 + 1 + 1 + 1 + 0.5 = 6.5 GiB` declarados: PostgreSQL recibe la mayor
parte por la contención de 12 salas y 7 colas, Valkey tiene margen para la
fan-in de 3 colas compartidas y API/worker comparten el presupuesto restante
para 24 conexiones por proceso. Queda margen dentro del presupuesto de
memoria de producción para el sistema operativo y Docker:

| Servicio | Límite |
|---|---:|
| `postgres` | `2g` |
| `valkey` | `1g` |
| `minio` | `1g` |
| `api` | `1g` |
| `worker` | `1g` |
| `web` | `512m` |

No existen `API_MEM_LIMIT` ni `WEB_MEM_LIMIT` en el contrato de despliegue.

## Qualification pre-evento

La qualification es un stack desechable de prueba de carga antes del evento,
con una base de datos y una instancia Valkey aisladas, cuentas sintéticas y
ningún puerto público. Se levanta sólo para validar una imagen inmutable y se
destruye después de recuperar el artefacto; nunca comparte estado, volumen,
red, secretos o servicios con producción.

Sus límites reflejan exactamente los servicios equivalentes de producción:
`postgres=2g`, `valkey=1g`, `api=1g` y `worker=1g`. El helper `migrate` usa
`512m` y el runner desechable usa `1g`; juntos, los seis servicios de la
qualification declaran 6.5 GiB y siguen bajo el presupuesto de memoria de
producción durante la prueba. `deploy/qualification/validate-compose.mjs`
falla antes del arranque si cambia una cifra o si la suma deja de estar bajo el
presupuesto. Como las cotas coinciden, pasar la qualification es una señal
útil de que la imagen puede operar bajo las cotas de producción, no un ensayo
con más memoria.

La carga por defecto redondea el evento a 600 participantes, 35 personas de
staff, 30 representantes de sponsors, 12 salas y 7 colas, 3 de ellas
compartidas. El procedimiento completo, incluido `validation.releaseBudgetPassed`,
está en [`docs/big-event-readiness.md`](../docs/big-event-readiness.md).

## Pool y admission durante el evento

El baseline de producción es `DB_POOL_MAX=24` por proceso: una API y un worker
usan 48 conexiones de pool. Con 12 conexiones operativas reservadas para
migración, mantenimiento, administración y superusuario, el cálculo es
`(1 × 24) + (1 × 24) + 12 = 60 < max_connections=100`. Mantén el valor stock
de `max_connections` y repite el cálculo antes de añadir réplicas o subir el
pool. El scheduler deriva 6 slots reservados para trabajo P0/P1 y limita la
cola pendiente P2/P3 a `max(16, 24 × 8) = 192`; son slots de peticiones finitas,
no conexiones SSE ni un slot por miembro del staff.

### Árbol de decisión de `DB_POOL_MAX`

Observa `hackos_http_request_admission_queue_size`, la tasa de `429` de P2/P3,
`pg_stat_activity`/la cuenta de conexiones, `hackos_db_pool_waiting` y el
estado OOM de los contenedores:

1. Si suben los `429` o la cola P2/P3, pero conexiones, latencia P0/P1 y
   memoria están sanas, conserva 24 si el trabajo es best-effort; para más
   throughput finito, recalcula conexiones y vuelve a ejecutar qualification.
2. Si las conexiones se acercan a 88, aumentan los lock waits o el pool espera,
   no subas `DB_POOL_MAX`: reduce el burst, corrige la consulta/bloqueo o haz
   un cambio de topología revisado.
3. Si Postgres entra en OOM, reduce pool/concurrencia y conserva el límite de
   `max_connections` hasta rehacer el presupuesto de memoria y pasar
   qualification.
4. Si P0/P1 espera mientras P2/P3 es rechazado, conserva 24 y revisa la ruta
   operativa; los 6 slots reservados protegen trabajo prioritario de todo
   tráfico P2/P3, incluso usuarios autenticados, pero no preemptan una
   petición ya ejecutándose.

### Cambiar un límite de memoria

Edita el límite del servicio en Compose, recrea sólo ese servicio y verifica su
salud. Si el servicio equivalente existe en qualification, cambia ambas cotas
en el mismo cambio y vuelve a ejecutar el validador:

```sh
# editar deploy/docker-compose.yml (y qualification si corresponde)
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml up -d --force-recreate <service>
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml ps <service>
```

La salida `healthy` es necesaria pero no sustituye la qualification completa.

## Splitting Postgres onto its own host (optional, advanced)

Si las métricas muestran que PostgreSQL es el cuello de botella, separar el
primario requiere una variante de Compose revisada: red privada entre los
hosts, `DATABASE_URL` apuntando al nombre privado del primario, reglas de
firewall mínimas, backups y una prueba de restauración. No se cambia la URL de
un contenedor en ejecución mediante un override ad-hoc. Recalcula el pool y el
presupuesto de memoria del servicio separado, ejecuta qualification contra la
misma topología prevista y documenta el rollback antes del evento.

## CI/CD paths

`.github/workflows/build.yml` clasifica los cambios antes de construir. Las
rutas de `apps/api` construyen sólo `hackos-api`, las de `apps/web` sólo
`hackos-web`, y `packages/shared` o los manifiestos de dependencias construyen
ambas. Mobile y documentación no producen imágenes ni disparan un despliegue.
Los archivos de runtime de `deploy/` no producen imágenes, pero en `staging`
disparan un rollout sólo de archivos: se transfieren Compose y los scripts, se
conservan los tags actuales de API/web y no se recrean esos contenedores. Cada
imagen afectada se construye en paralelo en sus `linux/amd64` y `linux/arm64`
nativos, y un job final publica el manifiesto multi-arquitectura
`sha-<commit>`; no se usa QEMU para compilar la imagen ARM.
El mismo workflow se puede lanzar manualmente desde Actions con la selección
`api`, `web` o `both`; en `staging`, esa reconstrucción publica y despliega
automáticamente únicamente las imágenes elegidas.

`.github/workflows/build.yml` calls the reusable
`.github/workflows/deploy-staging-arm64.yml` job after at least one affected
image manifest succeeds on a push to `staging`, or after a runtime deployment
file changes. For the latter, no image manifest is required: the reusable job
receives both API/web flags as false, retains the existing immutable image
tags, and refreshes only the deployment files. For image releases, the job
receives the API/web change flags and recreates only the changed unit; an API change runs
`migrate` and updates `api` + `worker`, while a web-only change updates only
`web`. A merge into `staging` therefore deploys the exact `sha-<40 hex>` image
tags just published without asking GHCR for a nonexistent sibling tag. It does
not use `latest` or race the GHCR publication. The staging job can also be
dispatched manually for an explicit SHA rollback or verification run. It joins the configured private
overlay network with an ephemeral GitHub Actions node, verifies the ARM64 host,
and uses SSH to transfer the Compose file and scripts. The staging environment
supplies the host address, user, and port variables. The repository-level
`STAGING_CD_SSH_PRIVATE_KEY` and `STAGING_CD_SSH_KNOWN_HOSTS` secrets are
dedicated to this workflow and contain only the deployment key and pinned host
key; they are not application secrets. It does not expose SSH through the
public ingress.

`.github/workflows/deploy-incus.yml` runs only by manual dispatch after an
operator selects a published SHA and its API/web image set. It passes those
partial-release flags to the host script and uses the protected `production`
environment. The protection of both environments must
be configured in GitHub (approval and, where appropriate, branch restrictions);
the workflows do not contain application secrets.

The production job needs an enabled self-hosted runner with local Incus
access. This dependency is explicit: the infrastructure repository currently
does not provide that runner, so enabling and registering it is a prerequisite
outside this repository. The staging job uses a GitHub-hosted runner plus a
private overlay network instead.

Both workflows check the tag and select the exact commit encoded in
`sha-<commit>`. The production workflow transfers files with `incus file push`
and executes the deployment with `incus exec`; the staging workflow uses the
equivalent SSH transfer on the ARM64 host. The host-local environment files
are validated without printing values, a `flock` lock prevents concurrent
deployments, pinned images are pulled, the optional R2 backup and `migrate`
run only for an API-image change, and healthchecks gate each changed unit.
Neither workflow decrypts SOPS, receives application secrets from Actions, or
exposes Docker Remote API. Any staging tunnel or proxy remains a separate
ingress service and must be routed to the new published ports when replacing
an existing platform.

For an operator-run redeploy, the host script can resolve the exact currently
configured immutable tag itself. It also remembers the independent API/web
tags in `/opt/hackos/.image-tags`, so the next partial release cannot roll the
unchanged service back accidentally:

```sh
HACKOS_APP_DIR=/opt/hackos /opt/hackos/incus-deploy.sh staging current
```

This is a convenience for operators; it still reads and validates a
`sha-<commit>` value from `IMAGE_TAG`. It never falls back to `latest` or a
mutable branch tag. The optional third and fourth arguments select whether to
update API and web respectively, for example
`incus-deploy.sh staging sha-<commit> false true` for a web-only update.

### Rollback

To return to the previous version, dispatch the relevant workflow with the
previous SHA tag from the deployment history. The workflow selects the exact
commit associated with the tag, so Compose and the scripts match that release;
each deployment also keeps a secret-free copy under
`/opt/hackos/releases/<tag>`. Rollback does not automatically reverse database
migrations: an incompatible migration needs a separately reviewed procedure.

## Orden de despliegue

Ejecutar desde la raíz del repositorio en el host correspondiente. En
producción es el LXC de producción; en staging es el host ARM64. El orden
conserva el proyecto existente y no elimina volúmenes.

```sh
CONFIG=/etc/hackos/hackos.env
SECRETS=/etc/hackos/hackos.secrets
RELEASE=sha-<40-lowercase-hex>
export IMAGE_TAG="$RELEASE" API_IMAGE_TAG="$RELEASE" WEB_IMAGE_TAG="$RELEASE"
COMPOSE=(docker compose --env-file "$CONFIG" --env-file "$SECRETS" -f deploy/docker-compose.yml)

./deploy/scripts/check-env.sh "$CONFIG" "$SECRETS"
"${COMPOSE[@]}" config >/dev/null

# 1. Descargar todas las imágenes; no hay build en ningún paso.
"${COMPOSE[@]}" pull

# 2. Arrancar dependencias y esperar sus healthchecks.
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 postgres valkey minio

# 3. Asegurar el bucket S3. Es idempotente.
"${COMPOSE[@]}" run --rm minio-init

# 4. Si R2_BACKUPS_ENABLED=true, ejecutar el backup antes de modificar el
#    esquema. El script usa los mismos ficheros de entorno y toma el lock.
if grep -q '^R2_BACKUPS_ENABLED=true$' "$CONFIG"; then
  /opt/hackos/backup-r2.sh production
fi

# 5. Ejecutar explícitamente la migración one-shot.
"${COMPOSE[@]}" run --rm migrate

# 6. Recrear sólo la aplicación con las imágenes descargadas.
"${COMPOSE[@]}" up -d --no-build --force-recreate api worker web

# 7. Esperar API, worker y web saludables.
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 api worker web
```

El entrypoint de `server.js` conserva además la comprobación de migraciones de
seguridad propia de la aplicación; el servicio `migrate` sigue siendo el paso
operativo explícito y bloquea el arranque mediante `depends_on` hasta terminar
correctamente.

## Service operations

Every deployment installs the same operator helper at
`/opt/hackos/services.sh`. The first argument must be the explicit environment
(`staging` or `production`); the helper derives the corresponding Compose
project name and refuses any other environment. It uses the host environment
files and the same deployment lock as the release script.

For staging, run the commands over the staging host's private SSH path:

```sh
STAGING_USER=staging-user
STAGING_HOST=staging-tailnet-host

ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging status
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging logs --tail 200 api worker web
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging logs --follow api
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging logs --event-type error api
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging start
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging recreate api
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging release api
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging available
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging deploy latest --both
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging deploy sha-<40-hex> --api
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging stop api
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging shutdown
```

For production, run the same helper through the private Incus path:

```sh
PRODUCTION_INSTANCE=production-instance

incus exec "$PRODUCTION_INSTANCE" -- /opt/hackos/services.sh production status
incus exec "$PRODUCTION_INSTANCE" -- /opt/hackos/services.sh production logs --tail 200 api worker web
incus exec "$PRODUCTION_INSTANCE" -- /opt/hackos/services.sh production start
incus exec "$PRODUCTION_INSTANCE" -- /opt/hackos/services.sh production shutdown
```

For an interactive menu, replace the action with `shell`:

```sh
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging shell
incus exec "$PRODUCTION_INSTANCE" -- /opt/hackos/services.sh production shell
```

The shell includes the CLI-only `system:superadmin` setup and management flow.
It calls the official server-side scripts in the API image, so grants and
revocations remain audited and the last active superadmin cannot be removed.
The interactive shell supports arrows, Enter or right-arrow to select,
left-arrow/Escape/`b` to go back, and `q` to quit. Service actions use Space
to select multiple services and Enter to confirm. Status includes a short
reason for stopped one-shot or failed containers. The log view supports
multi-select filters (`error`, `warning`, `request`, `health`) and optional
custom text search, with refresh/follow/filter/service navigation and an export
command for saving remote logs locally. Selected event categories are combined;
custom text narrows the result further. Start also offers per-service
start/recreate, image release information, and local rebuild instructions.
The home screen is task-led: **Overview**, **Operate installed services**,
**View logs**, **Images and releases**, **Manage superadmins**, and **Help**.
The service screen contains only start, stop, recreate and stop-all actions;
it never accesses the registry. The release screen separates inspection,
published-image browsing and deployment. Deployment then asks for the target
unit, resolves and displays the immutable SHA, and requires typing `DEPLOY`
before pulling or replacing anything.

### Lifecycle and release operations are deliberately separate

The same distinction applies to the interactive shell's **Releases and
deployment** submenu and to the CLI:

| Operation | Registry/GitHub access | Effect |
|---|---|---|
| `start`, `stop`, `recreate`, `shutdown` | None | Operate only on containers and images already present on the host. `start` never pulls. |
| `status`, `release` | Local Docker inspection only | Show service state; `release` also shows the deployed image, channel, commit and creation time. |
| `available` | GHCR package registry | List operator-selectable API/web images, distinguishing `staging`, `main` and legacy SHA tags. |
| `deploy latest` | Resolves the current channel release, then pulls it | Staging deploys the latest successful staging build; production prints the protected workflow command instead of bypassing approval. |
| `deploy sha-<commit>` | Validates the immutable SHA release, then pulls it | Deploy or roll back the selected API, web, or both units. |

`latest` never means Docker `:latest`: every deploy resolves a published
immutable `sha-<40 hexadecimal characters>` tag. The command prints the
environment, affected units and selected image tag before acting.
The non-interactive equivalents are:

```sh
/opt/hackos/services.sh staging superadmin list
read -r -s SUPERADMIN_PASSWORD
printf '%s\n' "$SUPERADMIN_PASSWORD" | \
  /opt/hackos/services.sh staging superadmin create --email admin@example.org \
  --password-stdin --name Event --surname Admin
unset SUPERADMIN_PASSWORD
/opt/hackos/services.sh staging superadmin grant --email existing@example.org
/opt/hackos/services.sh staging superadmin revoke --email admin@example.org
```

Replace `staging` with `production` when operating the production project.
For production, run the command through Incus as shown above, for example:
`incus exec "$PRODUCTION_INSTANCE" -- /opt/hackos/services.sh production
superadmin list`.
Create a new account only from a protected operator session; use `grant` when
the account already exists. The optional `--allow-existing-admin` override is
deliberate and should be used only when a second superadmin is required.

`status` includes stopped containers, `logs` accepts Compose service names, and
`start` starts the long-running runtime plus its required one-shot dependencies
and waits for health checks. `recreate` force-recreates selected services
without building; `release` shows the OCI revision and image build timestamp.
`stop` can target selected services, while `shutdown` stops the whole project.
Both retain persistent data. Release updates still go through immutable-image
CD; local rebuilds are for a repository checkout, not a deployment host.
The helper does not manage a host-level tunnel or proxy. Superadmin commands
use the running API container when available, otherwise a disposable one.

Capture a filtered log stream locally from your workstation:

```sh
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging logs \
  --event-type error api > hackos-api-errors.log
ssh "$STAGING_USER@$STAGING_HOST" /opt/hackos/services.sh staging logs \
  --match "request completed" --tail 500 api worker > hackos-requests.log
```

The interactive log view's `e` action prints an `ssh` + `scp` + cleanup block
when a remote file is preferable. When the shell was entered over SSH, the
current SSH user, server address, and non-default port are offered as the
default target; press Enter to accept it. `HACKOS_SSH_TARGET` and
`HACKOS_SSH_PORT` can override that default when an SSH alias is preferred.
When the shell was entered through Incus, provide the workstation-reachable
target at the prompt. The temporary remote file is removed only after `scp`
succeeds, so a failed transfer can be retried.

Use `ssh -tt ... logs --follow api` for a live colored stream.

Para revisar el estado y los logs:

```sh
"${COMPOSE[@]}" ps
"${COMPOSE[@]}" logs --tail=200 api worker web migrate
```

Para parar el runtime sin tocar datos:

```sh
"${COMPOSE[@]}" down
```

No usar `down --volumes` en una operación normal. El estado ya no vive en
volúmenes anónimos de Compose, sino en el volumen persistente del LXC; aun así,
una operación de limpieza o restauración sobre `/mnt/data` puede destruirlo.

## Persistencia y copias

El LXC debe montar su volumen persistente Incus en `/mnt/data`. Compose usa
`/mnt/data/postgres` y `/mnt/data/minio` mediante bind mounts; el despliegue
crea esos directorios si faltan y nunca declara volúmenes externos o de
proyecto. PostgreSQL contiene la fuente de verdad, auditoría, sesiones y
outbox; MinIO contiene ficheros y logos. Valkey es deliberadamente efímero:
BullMQ sólo marca el reloj y la señal realtime, mientras el estado durable
permanece en PostgreSQL.

Antes de un evento, verificar una restauración de PostgreSQL y MinIO. Con R2
activado, `backup-r2.sh` guarda un dump custom de PostgreSQL, el bucket MinIO y
un manifiesto bajo `R2_PREFIX/<environment>/<timestamp>/`. No borrar ni
recrear `/mnt/data` para actualizar imágenes.

`S3_PUBLIC_URL` debe ser una URL HTTPS de un ingress de objetos accesible por
el navegador y gestionado fuera de esta red. MinIO no publica ningún puerto en
el host; el ingress S3 debe
proporcionar el camino hasta su API sin publicar la consola. Los ficheros
privados siguen pasando por el API.

## Backups en Cloudflare R2

R2 expone una API compatible con S3. Crear manualmente un bucket privado y un
token de API limitado a ese bucket con permisos Object Read & Write; el
endpoint tiene la forma `https://<account-id>.r2.cloudflarestorage.com`.
Configurar entonces:

```text
# /etc/hackos/hackos.env
R2_BACKUPS_ENABLED=true
R2_BACKUP_FREQUENCY=daily # disabled, daily, weekly or monthly
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=hackos-backups
R2_PREFIX=hackos

# /etc/hackos/hackos.secrets (chmod 600)
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

La primera copia puede probarse dentro del LXC con:

```sh
/opt/hackos/backup-r2.sh production
```

La infraestructura instala el timer al aplicar la configuración del LXC. Usa
`R2_BACKUP_FREQUENCY=disabled` para no programarlo, o `daily`, `weekly` o
`monthly` después de validar las credenciales y una restauración. La frecuencia
no acepta expresiones cron arbitrarias; así una edición del `.env` no puede
inyectar opciones en systemd. Staging debe usar su propio `.env`, credenciales
y timer, nunca el de producción.

La política de retención debe configurarse en el bucket R2 (por ejemplo,
eliminación de objetos antiguos tras 90 días) y debe validarse una restauración
antes del primer evento. Este helper no descifra SOPS ni imprime credenciales;
la programación periódica mediante un timer del LXC queda gestionada por la
configuración de infraestructura, no por un despliegue de aplicación.

## Archivos canónicos

- [`docker-compose.yml`](./docker-compose.yml): runtime único.
- [`.env.example`](./.env.example): plantilla de configuración no secreta.
- [`scripts/check-env.sh`](./scripts/check-env.sh): validación previa sin
  revelar secretos.
- [`scripts/backup-r2.sh`](./scripts/backup-r2.sh): backup opt-in de PostgreSQL
  y MinIO a R2.
- [`scripts/services.sh`](./scripts/services.sh): operaciones seguras de estado,
  logs y ciclo de vida para los proyectos staging y production.
- La infraestructura genera las unidades systemd del backup a partir de
  `R2_BACKUP_FREQUENCY`.
- [`../docs/env-vars.md`](../docs/env-vars.md): contrato de variables por
  proceso.
