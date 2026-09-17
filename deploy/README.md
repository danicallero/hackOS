# Despliegue multi-arquitectura de hackOS

Este directorio contiene un único runtime de Docker Compose para staging en la
Raspberry Pi de casa y producción en el LXC `hackos`. El build publica
`linux/amd64` (obligatorio para el host de producción) y conserva `linux/arm64`; los hosts sólo
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
servicios de estado sólo están en `private`; API y worker usan ambas redes para
resolver (`postgres:5432`, `valkey:6379`, `minio:9000`) y acceder a proveedores
externos. `web` sólo necesita `egress`. No se declara ninguna red ajena al
proyecto.

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

# S3_PUBLIC_URL=https://s3.hackudc.com/hackos/
s3.hackudc.com {
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

## Configuración y secretos

Cada host mantiene dos ficheros planos fuera del repositorio:

- `/etc/hackos/hackos.env`: configuración no secreta, basada en
  [`deploy/.env.example`](./.env.example).
- `/etc/hackos/hackos.secrets`: credenciales y claves privadas, con permisos
  `0600` y sin copiarlo al repositorio.
- [`deploy/.env.secrets.example`](./.env.secrets.example): plantilla con los
  nombres de secretos y valores vacíos; nunca se usa como fichero real.

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
ghcr.io/danicallero/hackos-api:${IMAGE_TAG}
ghcr.io/danicallero/hackos-web:${IMAGE_TAG}
```

`IMAGE_TAG` es la única selección de versión y debe ser exactamente
`sha-<40 caracteres hexadecimales en minúscula>`. No se acepta `latest`, un
tag de rama ni una referencia de repositorio configurable. El workflow de CD
publica esos tags SHA; el servidor sólo hace pull.

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

## CD con Incus

`.github/workflows/build.yml` construye y publica `hackos-api` y `hackos-web`
en GHCR para `linux/amd64` y `linux/arm64`. Cada ejecución publica únicamente
el tag `sha-<commit>`; el CD sólo acepta ese formato y nunca usa `latest` ni
tags mutables de rama.

`.github/workflows/deploy-incus.yml` se ejecuta con `workflow_dispatch`, pide
`production` o `staging` y un tag `sha-<40 hex>`, y usa el environment de GitHub
correspondiente. La protección de esos environments debe estar configurada en
GitHub (revisión/aprobación y, si procede, restricciones de rama); el workflow
no contiene secretos de aplicación.

El job necesita un runner self-hosted habilitado y con acceso local a Incus.
Esta dependencia es explícita: el bloque `setup-gh-runner` del repositorio de
infraestructura está actualmente comentado, así que habilitar y registrar el
runner es una operación previa y no forma parte de este repositorio.

El workflow comprueba el tag, selecciona el commit codificado en
`sha-<commit>`, transfiere Compose, validación, backup y despliegue a
`/opt/hackos` mediante `incus file push`, y ejecuta el script con
`incus exec hackos`. El script usa los ficheros de entorno ya presentes dentro
del LXC, adquiere un lock con `flock`, valida la configuración sin imprimir
valores, prepara `/mnt/data/postgres` y `/mnt/data/minio`, hace pull de todas
las imágenes fijadas, ejecuta el backup R2 opt-in antes de `migrate`, ejecuta
`migrate`, recrea la aplicación y espera los healthchecks. La salida sólo
contiene estados y errores genéricos; no descifra SOPS, no recibe secretos de
Actions y no expone Docker Remote API.

### Rollback

Para volver a la versión anterior, lanzar de nuevo
`deploy-incus.yml` con el mismo environment y el tag SHA anterior que figure
en el historial de despliegues. El workflow vuelve a seleccionar el commit
exacto asociado al tag, por lo que Compose y los scripts también corresponden a
esa versión; cada despliegue conserva además una copia sin secretos en
`/opt/hackos/releases/<tag>`. El rollback no revierte automáticamente
migraciones de base de datos: una migración incompatible exige un procedimiento
revisado por separado.

## Orden de despliegue

Ejecutar desde la raíz del repositorio en el host correspondiente. En
producción es el LXC `hackos`; en staging es la Raspberry Pi. El orden
conserva el proyecto existente y no elimina volúmenes.

```sh
CONFIG=/etc/hackos/hackos.env
SECRETS=/etc/hackos/hackos.secrets
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

`S3_PUBLIC_URL` debe ser `https://s3.hackudc.com/hackos/` en producción y
apuntar a un endpoint HTTPS accesible por el navegador y gestionado fuera de
esta red. MinIO no publica ningún puerto en el LXC; el ingress S3 debe
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

Para programar una copia diaria, instalar y habilitar manualmente las unidades
incluidas en [`systemd/`](./systemd), sólo después de validar credenciales y
una restauración:

```sh
incus file push deploy/systemd/hackos-backup.service hackos/etc/systemd/system/hackos-backup.service
incus file push deploy/systemd/hackos-backup.timer hackos/etc/systemd/system/hackos-backup.timer
incus exec hackos -- systemctl daemon-reload
incus exec hackos -- systemctl enable --now hackos-backup.timer
```

El timer está preparado para producción; para staging hay que crear una unidad
equivalente que invoque `backup-r2.sh staging`.

La política de retención debe configurarse en el bucket R2 (por ejemplo,
eliminación de objetos antiguos tras 90 días) y debe validarse una restauración
antes del primer evento. Este helper no descifra SOPS ni imprime credenciales;
la programación periódica mediante un timer del LXC queda como habilitación
operativa manual porque el repositorio de infraestructura no está publicado.

## Archivos canónicos

- [`docker-compose.yml`](./docker-compose.yml): runtime único.
- [`.env.example`](./.env.example): plantilla de configuración no secreta.
- [`scripts/check-env.sh`](./scripts/check-env.sh): validación previa sin
  revelar secretos.
- [`scripts/backup-r2.sh`](./scripts/backup-r2.sh): backup opt-in de PostgreSQL
  y MinIO a R2.
- [`systemd/`](./systemd): unidades para habilitar el backup diario de forma
  manual.
- [`../docs/env-vars.md`](../docs/env-vars.md): contrato de variables por
  proceso.
