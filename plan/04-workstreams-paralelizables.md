# Workstreams paralelizables para desarrollo

## Carriles recomendados

| Carril | Historias | Dependencias de entrada | Bloqueos que genera |
|---|---|---|---|
| WS-A Identidad + Applications | H1-H15 | Ninguna | H16+, H22+, H43+ |
| WS-B Proyectos + Judging core | H16-H17, H29-H40 | WS-A (auth mínima) | H41-H42, parte de H50-H51 |
| WS-C Logística + Presencia + Wallet | H22-H28 | WS-A, H48 (definición de actividades) | Métricas de operación |
| WS-D TV + Público | H41-H42, H47-H49 | WS-B (estado de cola) | Visualización de evento |
| WS-E Sponsors | H43-H46 | WS-A + WS-B | Gestión de retos/jueces sponsor |
| WS-F Notificaciones + Auditoría + Export | H50-H54 | WS-A | Trazabilidad y comunicación global |
| WS-G Móvil | H55 | WS-A/B/C/F | UX final multirol |

## Política de asignación por carril

1. Un responsable = un carril principal.
2. Evitar tocar los mismos módulos entre carriles en paralelo.
3. Si un PR rompe trazabilidad de historias `Hxx`, no se integra.

## Cadencia recomendada

- Ciclos cortos por lote de historias afines (2-4 historias/lote).
- Integración diaria a rama troncal con tests de regresión de dominio.
- Cerrar primero P0/P1 aunque exista capacidad ociosa en P2/P3.
