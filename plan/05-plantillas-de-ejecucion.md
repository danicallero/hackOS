# Plantillas para ejecución de desarrollo

## 1) Plantilla de tarea (una historia)

```md
### Implementar Hxx - <titulo>
- Historia fuente: Hxx en `historias-hackos.md`
- Objetivo funcional:
- Módulos tocados:
- Riesgos:
- Criterios de aceptación:
  - [ ] Flujo principal implementado
  - [ ] Errores de negocio explícitos
  - [ ] Auditoría en acciones sensibles
  - [ ] Pruebas del dominio
```

## 2) Brief base para implementación

```txt
Implementa la historia Hxx (<titulo>) usando como fuente única `historias-hackos.md`.
No uses documentación fuera de `plan/` como fuente normativa.
Entrega:
1) Cambios de código.
2) Lista de criterios de aceptación cumplidos.
3) Mapeo exacto de ficheros tocados.
4) Riesgos o deuda técnica abierta.
```

## 3) Prompt de revisión funcional (QA de historia)

```txt
Revisa si la implementación de Hxx cumple la semántica funcional de `historias-hackos.md`.
Valida especialmente:
- Estados y transiciones.
- Casos límite explícitos en la historia.
- Coherencia con auditoría y notificaciones cuando aplique.
Reporta solo incumplimientos y riesgo.
```

## Definition of Done global (por lote)

- Cada commit/PR referencia historias `Hxx`.
- No se introducen atajos que contradigan la narrativa funcional.
- Cambios sensibles dejan rastro auditable.
- El comportamiento en concurrencia queda cubierto donde aplica.
