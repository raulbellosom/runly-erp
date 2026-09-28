---
viewKey: /module-builder/relaciones
title: Constructor - Relaciones e integridad
summary: Como protege Runly las relaciones entre entidades de tu modulo - registros validos al guardar y que pasa al desactivar un registro que otros usan (Bloquear, Dejar vacio, Desactivar tambien).
---
Un campo de **Relacion** liga un registro con otro de la misma aplicacion: el Pedido con su Cliente, la Visita con su Sucursal. Runly cuida que esas ligas siempre sean validas.

### Al guardar

Al crear o editar un registro, el servidor revisa que el registro relacionado **exista, este activo y pertenezca a la misma empresa**. Si no, no guarda y avisa: *El registro seleccionado en "Cliente" no existe o esta inactivo.* Elige otro registro o reactiva el original.

### Al desactivar un registro que otros usan

Cada campo de relacion define que pasa cuando alguien desactiva el registro al que apunta. Se configura en el campo, opcion **Al desactivar el registro relacionado**:

| Opcion | Que hace | Cuando usarla |
|---|---|---|
| **Bloquear** (por defecto) | No deja desactivar y muestra cuantos registros lo usan: *No se puede desactivar: 3 Pedidos lo usan.* | Cuando el registro relacionado es indispensable (un Pedido siempre necesita su Cliente). |
| **Dejar vacio** | Desactiva el registro y limpia la relacion en los que lo usaban. | Cuando la relacion es opcional (una Etiqueta que puede quedarse sin Cliente). No disponible si el campo es requerido. |
| **Desactivar tambien** | Desactiva en cascada los registros que lo usaban; cada uno aplica a su vez sus propias reglas. | Cuando los registros no tienen sentido sin el principal (las Notas de un Cliente). |

Todo ocurre en una sola operacion: si algo falla (por ejemplo, una regla "Bloquear" en un registro hijo), **no se desactiva nada**.

### Que hacer si no puedes desactivar

El mensaje dice cuantos registros lo usan. Puedes reasignarlos a otro registro, desactivarlos primero, o pedir a quien administra el modulo que cambie la regla a "Dejar vacio" o "Desactivar tambien".

### Mostrar el nombre y listas relacionadas

- **Campo a mostrar**: tablas, detalle y selectores muestran ese dato del registro relacionado (por ejemplo, el nombre del cliente).
- **Registros relacionados**: en el Diseno de la entidad principal puedes agregar una seccion que liste, en su detalle, los registros que apuntan a ella (los Pedidos del Cliente), cada uno con enlace a su propia ficha.

### Limites

- Las relaciones solo apuntan a entidades del mismo modulo.
- El Constructor no permite reglas "Desactivar tambien" que formen un ciclo (A desactiva a B y B desactiva a A).
- Reactivar un registro no reactiva en cascada a los que se desactivaron con el.
