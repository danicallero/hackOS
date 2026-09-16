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
```

Los valores de `API_DOMAIN`, `WEB_DOMAIN` y `CORS_ORIGINS` deben corresponder
con esos hosts. `API_DOMAIN` y `WEB_DOMAIN` son nombres sin `https://`.

## Configuración y secretos

Cada host mantiene dos ficheros planos fuera del repositorio:

- `/etc/hackos/hackos.env`: configuración no secreta, basada en
  [`deploy/.env.example`](./.env.example).
- `/etc/hackos/hackos.secrets`: credenciales y claves privadas, con permisos
  `0600` y sin copiarlo al repositorio.

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
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
VALKEY_PASSWORD
MINIO_ROOT_USER
MINIO_ROOT_PASSWORD
BETTER_AUTH_SECRET
S3_ACCESS_KEY
S3_SECRET_KEY
```

Para correo, `MAIL_PROVIDER=smtp` requiere `SMTP_HOST`. En producción se puede
usar Amazon SES a través de su endpoint SMTP; `SMTP_USER` y `SMTP_PASS` se
guardan en el fichero de secretos cuando el relay requiere autenticación. Las
claves de firma de Apple/Google son opcionales, pero cada bloque configurado
debe estar completo. `check-env.sh` no imprime valores secretos.

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

Las imágenes de infraestructura también están fijadas a versiones concretas
en el Compose. No se modifican en el servidor.

Los límites de memoria actuales se mantienen como literales, sin variables de
override:

| Servicio | Límite |
|---|---:|
| `postgres` | `1g` |
| `valkey` | `512m` |
| `minio` | `1g` |
| `api` | `512m` |
| `worker` | `512m` |
| `web` | `256m` |

No existen `API_MEM_LIMIT` ni `WEB_MEM_LIMIT` en el contrato de despliegue.

## CD con Incus

`.github/workflows/build.yml` construye y publica `hackos-api` y `hackos-web`
en GHCR para `linux/amd64` y `linux/arm64`. Cada ejecución genera el tag de
rama y `sha-<commit>`; el CD sólo acepta el segundo formato y nunca usa
`latest`.

`.github/workflows/deploy-incus.yml` se ejecuta con `workflow_dispatch`, pide
`production` o `staging` y un tag `sha-<40 hex>`, y usa el environment de GitHub
correspondiente. La protección de esos environments debe estar configurada en
GitHub (revisión/aprobación y, si procede, restricciones de rama); el workflow
no contiene secretos de aplicación.

El job necesita un runner self-hosted habilitado y con acceso local a Incus.
Esta dependencia es explícita: el bloque `setup-gh-runner` del repositorio de
infraestructura está actualmente comentado, así que habilitar y registrar el
runner es una operación previa y no forma parte de este repositorio.

El workflow comprueba el tag, transfiere Compose, `check-env.sh` y
`incus-deploy.sh` con `incus file push`, y ejecuta el script con
`incus exec hackos`. El script usa `/etc/hackos/hackos.env` y
`/etc/hackos/hackos.secrets` ya presentes dentro del LXC, adquiere un lock con
`flock`, valida la configuración sin imprimir valores, hace pull de API,
worker y web, ejecuta `migrate`, recrea la aplicación y espera los
healthchecks. La salida sólo contiene estados y errores genéricos; no descifra
SOPS, no recibe secretos de Actions y no expone Docker Remote API.

### Rollback

Para volver a la versión anterior, lanzar de nuevo
`deploy-incus.yml` con el mismo environment y el tag SHA anterior que figure
en el historial de despliegues. El rollback sólo cambia imágenes: no revierte
automáticamente migraciones de base de datos. Una migración incompatible exige
un procedimiento de base de datos revisado por separado.

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

# 4. Ejecutar explícitamente la migración one-shot.
"${COMPOSE[@]}" run --rm migrate

# 5. Recrear sólo la aplicación con las imágenes descargadas.
"${COMPOSE[@]}" up -d --no-build --force-recreate api worker web

# 6. Esperar API, worker y web saludables.
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

No usar `down --volumes` en una operación normal: elimina los volúmenes
persistentes de PostgreSQL y MinIO.

## Persistencia y copias

Compose crea los volúmenes de proyecto `postgres-data` y `minio-data`.
PostgreSQL contiene la fuente de verdad, auditoría, sesiones y outbox; MinIO
contiene ficheros y logos. Valkey es deliberadamente efímero: BullMQ sólo
marca el reloj y la señal realtime, mientras el estado durable permanece en
PostgreSQL.

Antes de un evento, verificar copias restaurables de ambos volúmenes y de un
`pg_dump` de la base de datos. No borrar ni recrear volúmenes para actualizar
imágenes.

`S3_PUBLIC_URL`, si se configura, debe apuntar a un endpoint HTTPS accesible
por el navegador y gestionado fuera de esta red. MinIO no publica ningún
puerto en el LXC; los ficheros privados siguen pasando por el API.

## Archivos canónicos

- [`docker-compose.yml`](./docker-compose.yml): runtime único.
- [`.env.example`](./.env.example): plantilla de configuración no secreta.
- [`scripts/check-env.sh`](./scripts/check-env.sh): validación previa sin
  revelar secretos.
- [`../docs/env-vars.md`](../docs/env-vars.md): contrato de variables por
  proceso.
