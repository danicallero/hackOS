# Esquema: punto de partida y revisión obligatoria

El archivo `schema-boceto.dbml` se incluye como base inicial de modelado.

## Regla

No se considera definitivo: **debe revisarse y ajustarse** con trazabilidad a `Hxx` de `historias-hackos.md`.

## Checklist mínimo de revisión

1. Cobertura de identidad y permisos por capacidades (H1-H10).
2. Flujo de applications y confirmación (H11-H15).
3. Proyectos/importación y matching de personas (H16-H17).
4. Ticket vs badge + rotación + wallet (H22-H23, H28).
5. Colas/judging con estados y transiciones de H29-H40.
6. Auditoría y exportación de acciones sensibles (H53-H54).
7. Soporte de horarios, actividades, anuncios y notificaciones (H47-H52).

## Criterio de aceptación

- Cada cambio de esquema referencia historias `Hxx`.
- No hay tablas/campos sin justificación funcional.
- Se documentan deltas relevantes respecto al boceto inicial.
