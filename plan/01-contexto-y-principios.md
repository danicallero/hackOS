# Contexto y principios de implementación

Base: `historias-hackos.md`.

## Producto

hackOS unifica identidad, inscripciones, proyectos, logística, judging, TV, sponsors, contenido público y notificaciones.

## Arquitectura objetivo

- Arquitectura:
  - API (Fastify + BullMQ)
  - Web (Next.js)
  - Móvil (React Native + Expo)
- Auth: Better Auth dentro de API.
- Datos: DB de hackOS como única verdad.
- Colas/microestado: Valkey.
- Pantallas TV: SSE nativo.
- Push móvil: Expo Notifications.
- Ficheros: S3 (MinIO autohospedado).
- Wallet: endpoints nativos (`.pkpass` y Google Wallet).

## Invariantes funcionales que no se negocian

1. Permisos por **capacidades**, no por rol ilustrativo (H8).
2. Ticket y badge son cosas distintas (H22-H23-H28).
3. Decisión de application es interna hasta el envío (H14).
4. No-show con criterio humano; no automatizar expulsión silenciosa (H34).
5. Cola de judging por reto con etapas físicas explícitas: llamado → en sala → presentando (H29-H32).
6. Nunca llamar un equipo en dos salas simultáneas si comparte miembros (H30).
7. Evaluación colaborativa y versionada, sin pérdida de borradores (H36).
8. En escáneres, tolerancia a red inestable con cola local + reintentos idempotentes (H22, H25, H26).

## Alcance MVP recomendado

- Incluye H1-H17, H22-H28, H29-H42, H43-H46, H47-H55.
- Deja como post-MVP explícito: H18-H21 (creación de proyectos nativa y edición caliente avanzada).

## Política de documentación para desarrollo

- Todo cambio técnico debe enlazar a historias `Hxx`.
- Si hay conflicto documental, gana `historias-hackos.md`.
- Evitar decisiones “implícitas”: registrar dependencia y criterio de aceptación en la tarea.
