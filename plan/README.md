# Plan de desarrollo (fuente actual)

Este directorio deja listo el arranque de desarrollo en otro repositorio/directorio.

## Fuente de verdad

- **Vigente:** `historias-hackos.md`
- **Boceto técnico inicial:** `schema-boceto.dbml` (punto de partida, no definitivo)

## Qué contiene este paquete

1. `01-contexto-y-principios.md`: límites del sistema y decisiones base.
2. `02-backlog-trazable.md`: backlog por historias (H1..H55), con alcance MVP/post-MVP.
3. `03-roadmap-desarrollo.md`: orden de implementación por fases y criterios de salida.
4. `04-workstreams-paralelizables.md`: división en carriles para trabajo en paralelo.
5. `05-plantillas-de-ejecucion.md`: prompts y Definition of Done para ejecutar.
6. `schema-boceto.dbml`: esquema inicial a revisar y ajustar contra las historias.
7. `06-schema-punto-de-partida.md`: criterios y checklist de revisión del esquema.
8. `07-datos-relevantes-ers.md`: invariantes y reglas operativas incorporadas desde ERS.

## Cómo usarlo en otro directorio

1. Copia la carpeta `plan/`.
2. Arranca por `03-roadmap-desarrollo.md`.
3. Ejecuta trabajos en paralelo siguiendo `04-workstreams-paralelizables.md`.
4. Obliga trazabilidad: cada tarea debe referenciar historias `Hxx`.
5. Revisa/modifica `schema-boceto.dbml` al inicio y durante el desarrollo.
