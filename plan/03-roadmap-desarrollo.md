# Roadmap de desarrollo

Objetivo: entregar por fases, con paralelismo seguro y trazabilidad a `Hxx`.

## Fase 0 — Setup (corto)

- Contrato de eventos en tiempo real (SSE).
- Contrato de idempotencia para operaciones críticas.
- Marco de auditoría base (H53).
- Revisión del esquema base `schema-boceto.dbml` contra `historias-hackos.md`.
- Alineación técnica con `07-datos-relevantes-ers.md` (INV/NFR y máquinas de estado).

**Salida:** base técnica común para trabajar en paralelo.

## Fase 1 — Fundaciones (P0)

- Identidad y permisos: H1-H10.
- **Applications completas:** H11-H15.

**Salida:** cuentas operativas + embudo de inscripción/decisión/confirmación funcionando.

## Fase 2 — Núcleo del evento (P0)

- Proyectos por importación: H16-H17.
- Colas y judging: H29-H40.
- TV en vivo: H41-H42.

**Salida:** flujo de evaluación E2E estable.

## Fase 3 — Operación física (P1)

- Acreditación, presencia, comidas y actividades: H22-H27.
- Wallet (ticket + badge): H28.

**Salida:** check-in y logística robustos en condiciones reales de evento.

## Fase 4 — Producto completo (P2)

- Sponsors: H43-H46.
- Horario y contenido público: H47-H49.
- Notificaciones y correo: H50-H52.

**Salida:** experiencia completa para sponsors, asistentes y staff.

## Fase 5 — Cierre y expansión (P2/P3)

- Exportaciones y datos personales: H54.
- Móvil único por capacidades: H55.
- Post-MVP: H18-H21.

**Salida:** plataforma completa + backlog de expansión claro.

## Regla de avance

No se abre una fase nueva si la anterior no cumple su criterio de salida.
