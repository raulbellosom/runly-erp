---
viewKey: /identity/roles
title: Roles
summary: Define que puede ver y hacer cada rol, permiso por permiso.
---
Un rol es un conjunto de permisos con un nombre. En vez de asignar permisos uno por uno a cada usuario, se los asignas a un rol y luego asignas ese rol a los usuarios.

- Los roles marcados como "sistema" (ej. Administrador) no se pueden editar ni borrar — garantizan que siempre exista al menos un rol con acceso total.
- Al crear un rol nuevo eliges exactamente que permisos otorga, modulo por modulo y accion por accion (ver, crear, editar, eliminar, etc. segun lo que declare cada modulo).
- Cambiar los permisos de un rol afecta de inmediato a todos los usuarios que lo tienen asignado — no hace falta que vuelvan a iniciar sesion para que el cambio surta efecto.
- Un rol que ya tiene usuarios asignados no se puede borrar; primero hay que reasignar a esos usuarios a otro rol.
