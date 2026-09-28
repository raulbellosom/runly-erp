# Encuestas para Runly — v1.1.1

Módulo completo de encuestas con constructor React, publicación, captura de respuestas, resultados y una integración opcional con Identity/RR. HH./Inventario.

## Flujo de identidad e inventario

En una encuesta se puede activar **Identidad e inventario asignado**. Para esas encuestas Runly identifica automáticamente al usuario de la sesión, resuelve el colaborador de RR. HH. vinculado a su `UserProfile` y obtiene los artículos de inventario que están asignados a ese colaborador.

La respuesta persiste una fotografía de ese contexto: id/nombre/correo del usuario, colaborador y lista de artículos con asset tag, nombre, modelo, serie, parte, estado y ubicación. Esto permite consultar después qué activos tenía asignados el participante exactamente cuando llenó la encuesta.

## Integraciones utilizadas

- Identity: `userContext` / `UserProfile.id` del usuario autenticado.
- RR. HH.: `HrEmployee.userProfileId` para encontrar el colaborador correspondiente.
- Inventario: `InvItem.assignedToId` para obtener sus artículos activos.
- Relaciones RME3: `moduleContext.relations.resolve` y `/relation-targets/{type}/resolve` para aplicar permisos, visibilidad y etiquetas de los módulos dueños.
- Tipos externos utilizados: `hr_employee` e `inventory_item`.

## Permisos adicionales para encuestas con contexto

Además de `encuestas.respuestas.create`, el participante necesita:

- `hr.employee.read`
- `inventory.assignment.read`
- `inventory.item.read`

Las encuestas que no activan la captura de identidad/inventario conservan el flujo normal.

## Documentación

El ZIP conserva `AGENTS.md` y `GUIA_DESARROLLO_RUNLY.md`. La guía enlaza al índice para LLM (`https://runly.mx/llms.txt`) y a la documentación de desarrolladores de Runly.
