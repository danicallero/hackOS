# Plan de despliegue e infraestructura (Dokploy)

Fuente funcional: `historias-hackos.md`.  
Invariantes operativas: `07-datos-relevantes-ers.md`.

## Objetivo de infraestructura

Montar hackOS en **servicios independientes** dentro de un proyecto para que:

1. Un fallo o redeploy de `web`/`api` no tire `postgres`.
2. Cada servicio se pueda reiniciar por separado.
3. Los datos críticos vivan en volúmenes persistentes.
4. Exista entorno de producción y entorno de pruebas aislados.

## Topología recomendada (mismo proyecto, servicios separados)

### Servicios stateful (con volumen persistente)

- `postgres` (PostgreSQL 17)
- `valkey` (colas y cache)
- `minio` (S3 autohospedado)

### Servicios stateless (sin volumen de datos de negocio)

- `api` (Fastify)
- `worker` (BullMQ separado; mismo código que API)
- `web` (cuando exista app web)

### Servicio de administración (opcional)

- `db-admin` (visor/gestor de tablas PostgreSQL)

## Regla de oro para evitar resets accidentales

- **Nunca** borrar volúmenes de `postgres` en redeploy de otros servicios.
- Reiniciar/redeploy siempre por servicio (`web`, `api`, `worker`) y no el proyecto completo.

---

## 1) Producción (paso a paso)

### 1. Crear proyecto y red interna

1. Crear proyecto `hackos`.
2. Usar una red privada interna para comunicación entre servicios.
3. Exponer públicamente solo `api`, `web` (si existe) y `db-admin` (si se habilita).

### 2. Levantar bases stateful

1. Crear servicio `postgres` (imagen `postgres:17-alpine`).
2. Configurar volumen persistente (ejemplo: `hackos_pgdata_prod`).
3. Definir:
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `POSTGRES_DB=hackos`
4. Crear servicio `valkey` (imagen `valkey/valkey:8-alpine`) con volumen opcional.
5. Crear servicio `minio` con volumen persistente y credenciales fuertes.

### 3. Desplegar API y worker separados

1. Crear servicio `api` desde `apps/api/Dockerfile`.
2. Variables mínimas:
   - `NODE_ENV=production`
   - `WORKERS_INLINE=false`
   - `DATABASE_URL=postgresql://<user>:<pass>@postgres:5432/hackos`
   - `VALKEY_URL=redis://:<valkey_password>@valkey:6379`
   - `S3_ENDPOINT=http://minio:9000`
   - `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`
   - `BETTER_AUTH_URL=https://api.tudominio.com`
   - `BETTER_AUTH_SECRET` (largo y aleatorio)
   - `MAIL_PROVIDER` + credenciales del proveedor elegido
3. Crear servicio `worker` con la **misma imagen** que `api` y comando:
   - `node dist/src/worker.js`
4. En `worker`, usar mismas variables de conexión (`DATABASE_URL`, `VALKEY_URL`, etc.).

### 4. Exposición y dominios

1. Asignar dominio a `api` (ej. `api.hackos.com`).
2. Activar TLS/HTTPS en proxy.
3. (Cuando exista) asignar `app.hackos.com` a `web`.
4. No exponer `postgres`, `valkey` ni `minio` públicamente.

### 5. Checklist de operación

1. Redeploy `api` sin tocar volúmenes.
2. Redeploy `web` sin tocar `postgres`.
3. Reinicio de `worker` independiente.
4. Backups de `postgres` programados.

### 6. MinIO (template Dokploy recomendado)

Usa el compose generado por Dokploy como base y conserva estas reglas:

1. Volumen persistente (`minio-data:/data`).
2. API en `9000`; consola en `9001` con acceso restringido.
3. `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` fuertes.
4. `MINIO_BROWSER_REDIRECT_URL` al dominio HTTPS de consola.
5. Si necesitas UI clásica, fija release previa:
   - `minio/minio:RELEASE.2025-04-22T22-12-26Z`

```yaml
services:
  minio:
    image: minio/minio
    restart: unless-stopped
    volumes:
      - minio-data:/data
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
      MINIO_BROWSER_REDIRECT_URL: ${MINIO_BROWSER_REDIRECT_URL}
    command: server /data --console-address ":9001"
    ports:
      - 9000:9000
    expose:
      - "9001"

volumes:
  minio-data:
```

---

## 2) Entorno de pruebas dentro del mismo proyecto

Recomendación: separar por prefijo de servicio y recursos:

- `stg-postgres`, `stg-valkey`, `stg-minio`, `stg-api`, `stg-worker`, `stg-web`.
- Dominios: `api-stg.hackos.com`, `app-stg.hackos.com`.
- Volúmenes separados: `hackos_pgdata_stg`, etc.
- Base separada (`hackos_staging`) o clúster separado.

### Paso a paso

1. Duplicar stack de producción a `stg-*`.
2. Cambiar secretos y URLs para staging.
3. Confirmar que `DATABASE_URL` de staging **no** apunta a producción.
4. Mantener el mismo patrón: `WORKERS_INLINE=false`, `api` + `worker` separados.
5. Ejecutar migraciones en staging antes de promover cambios a producción.

---

## 3) Visor de PostgreSQL autohospedado y open source

Para replicar experiencia tipo panel de tablas (estilo Supabase), opción recomendada:

- **pgAdmin 4** (open source, self-hosted)

Alternativas:

- **CloudBeaver Community** (open source)
- **Adminer** (open source, más simple)

### Despliegue recomendado de `db-admin`

1. Crear servicio `db-admin` en el mismo proyecto.
2. Conectarlo a `postgres` por red interna.
3. Exponerlo con HTTPS y autenticación fuerte.
4. Restringir acceso (allowlist IP o VPN).
5. Usarlo para:
   - navegar tablas
   - editar datos
   - ejecutar SQL
   - cambios de esquema manuales puntuales

> Nota operativa: los cambios de esquema en hackOS deben seguir migraciones SQL en `apps/api/db/migrations`.

---

## 4) Local sin Docker (paso a paso)

### Requisitos

- Node.js >= 22
- pnpm
- PostgreSQL 17
- Valkey/Redis compatible
- MinIO (opcional si pruebas ficheros)

### Arranque

1. Instalar dependencias:
   - `pnpm install`
2. Crear base de datos local `hackos`.
3. Configurar `apps/api/.env` con endpoints locales:
   - `DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/hackos`
   - `VALKEY_URL=redis://localhost:6379`
   - `S3_ENDPOINT=http://localhost:9000`
   - `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`
   - `BETTER_AUTH_URL=http://localhost:3000`
   - `BETTER_AUTH_SECRET=<secret_local>`
4. Aplicar migraciones:
   - `pnpm migrate`
5. Ejecutar API:
   - `pnpm dev`

### Worker local (opcional separado)

- Para replicar producción, compilar y levantar worker aparte:
  1. `pnpm --filter @hackos/api build`
  2. `WORKERS_INLINE=false node apps/api/dist/src/worker.js`

---

## 5) Variables mínimas por servicio

### API/worker

- `NODE_ENV`
- `WORKERS_INLINE` (`false` en prod/staging)
- `DATABASE_URL`
- `VALKEY_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `MAIL_PROVIDER`
- `MAIL_FROM_ADDRESS`
- `MAIL_FROM_NAME`
- Credenciales del proveedor de correo según `MAIL_PROVIDER`

### Postgres

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- Volumen persistente

### MinIO

- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- Volumen persistente

---

## 6) Decisiones de arquitectura a mantener

1. Separación estricta entre stateful y stateless.
2. `worker` dedicado en producción (no inline).
3. Sin exposición pública de servicios de datos.
4. Cambios de esquema vía migraciones SQL versionadas.
