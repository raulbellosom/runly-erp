---
title: Identidad
summary: Usuarios del sistema, roles y permisos, y reportes de moderacion del chat.
---
Runly Identidad administra quien puede entrar al sistema y que puede hacer una vez adentro.

- **Usuarios**: las cuentas que pueden iniciar sesion en esta instancia (nombre, correo, telefono, estado activo/inactivo).
- **Roles**: conjuntos de permisos con nombre (ej. "Administrador", "Ventas"). Cada usuario tiene un rol por compania.
- **Reportes de chat**: mensajes reportados por otros usuarios para que un administrador los revise.

### Alcances y limites

- Un usuario puede pertenecer a varias companias con un rol distinto en cada una (membresias).
- Crear/editar roles y asignar permisos requiere permisos de administracion; un usuario normal solo ve y edita su propio perfil.
- Desactivar un usuario le impide iniciar sesion pero no borra su historial ni los registros que creo.
