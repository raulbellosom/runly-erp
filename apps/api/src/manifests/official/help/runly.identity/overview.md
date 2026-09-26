---
title: Identidad
summary: Usuarios del sistema, roles y permisos, y reportes de moderacion del chat.
---
Runly Identidad administra quien puede entrar al sistema y que puede hacer una vez adentro. Es un modulo **core**: siempre esta instalado, porque es la base del control de acceso de toda la instancia.

- **Usuarios**: las cuentas que pueden iniciar sesion en esta instancia (nombre, correo, telefono, avatar, estado activo/inactivo).
- **Roles**: conjuntos de permisos con nombre (ej. "Administrador", "Ventas"). Cada usuario tiene un rol por compania a la que pertenece.
- **Reportes de chat**: mensajes reportados por otros usuarios para que un administrador los revise y decida si hay que actuar.

### Como funciona el control de acceso

- Un permiso es una accion concreta sobre un modulo (por ejemplo, "crear contactos" o "instalar modulos"). Los permisos no se asignan uno por uno a cada persona: se agrupan en roles, y a cada usuario se le asigna un rol.
- Cada modulo que instalas declara sus propios permisos en su manifiesto; Identidad los junta todos en un catalogo unico que ves al armar un rol.
- Si a alguien le falta acceso a algo, la solucion casi siempre es ajustar su rol (o el rol en si, si afecta a todo un equipo) en vez de tocar permisos individuales.

### Alcances y limites

- Un usuario puede pertenecer a varias companias con un rol distinto en cada una (membresias) — el mismo usuario puede ser "Administrador" en una compania y "Ventas" en otra.
- Crear/editar roles y asignar permisos requiere permisos de administracion; un usuario normal solo ve y edita su propio perfil.
- Desactivar un usuario le impide iniciar sesion pero no borra su historial ni los registros que creo — la informacion que generó sigue intacta en los demas modulos.
