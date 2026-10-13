# Backlog trazable a historias (H1..H60)

Base única: `historias-hackos.md`.

## Mapa por dominios

| Dominio | Historias | Prioridad | Notas |
|---|---|---|---|
| Identidad y permisos | H1-H10 | P0 | Fundacional para todo lo transaccional. H6 retirada. |
| Inscripción | H11-H15 | P1 | Flujo completo de decisión y confirmación. |
| Proyectos (envío propio de hackOS) | H16-H21 | P1 | Núcleo MVP para alimentar judging; sin importación externa. |
| Ganadores | H60 | P2 | Publicación programada antes de la ceremonia de clausura. |
| Acreditación/logística | H22-H28 | P1 | Operativa de evento + presencia + wallet. |
| Colas y judging | H29-H40 | P0 | Bloque crítico e innegociable. |
| TV | H41-H42 | P1 | Depende de estado de colas en tiempo real. |
| Sponsors | H43-H46 | P2 | Depende de identidad + judging. |
| Horario/contenido público | H47-H49 | P2 | Puede avanzar en paralelo a sponsors. |
| Avisos/notificaciones | H50-H52 | P2 | Soporta operaciones y comunicación. |
| Administración/auditoría | H53-H54 | P1 | Transversal desde el primer sprint. |
| Móvil único | H55 | P2 | Sobre capacidades ya estables. |

## Dependencias críticas entre historias

1. H1-H10 → habilita H11+ y H43+.
2. H11-H15 → habilita H22, H28 y analítica de embudo (H27).
3. H16-H21 → habilita H29-H40; H16-H17 habilitan H18-H20.
4. H29-H40 y H45 (publicación programada) → habilitan H60.
5. H29-H40 → habilita H41-H42 y parte operativa de H50-H51.
6. H48 → define comidas/actividades necesarias para H25-H26.
7. H53-H54 son transversales: deben instrumentarse desde el inicio.

## Criterio de “listo” por historia (mínimo)

- Endpoint/UI funcional + validaciones de negocio.
- Eventos sensibles auditados (H53).
- Estados de error explícitos (sin silencios).
- Cobertura de concurrencia donde aplica (H25, H29-H36).
- Trazabilidad en PR: “Implementa Hxx”.
