---
title: Runly Core
summary: "El nucleo del sistema: administra los modulos instalados, la configuracion general de la instancia y la bitacora de auditoria."
---
Runly Core es el modulo base de todo el ERP: no vende, no factura ni administra empleados, pero es lo que hace que los demas modulos se puedan instalar, conectar entre si y funcionar de forma ordenada. Siempre esta instalado y no se puede desinstalar ni deshabilitar.

Desde aqui se administra:

- **Modulos**: ver el catalogo completo de modulos disponibles para tu instancia, instalarlos, habilitarlos o deshabilitarlos temporalmente, y desinstalarlos cuando ya no los necesitas (con la opcion de conservar o purgar sus datos).
- **Configuracion**: ajustes generales de la instancia que aplican a todas las companias que operan sobre ella (nombre de la empresa por defecto, zona horaria, preferencias de la plataforma).
- **Constructor de modulos**: crear tus propios modulos sin programar (entidades, campos, pantallas con pestanas y secciones, condiciones, relaciones, archivos, vistas, conexiones y automatizaciones con otros modulos) y publicarlos en la instancia.
- **Bitacora de auditoria**: un registro de quien hizo que y cuando, en cualquier parte del sistema — util para investigar un cambio inesperado o confirmar que una accion se realizo correctamente.
- **Pantalla de inicio**: el punto de partida al entrar a Runly, con accesos directos a los modulos instalados y a la ayuda contextual.

### Como se conecta con el resto del sistema

- Cada modulo que instalas (Contactos, RRHH, POS, etc.) declara sus propios permisos y su navegacion; Runly Core es quien lee esa declaracion y arma el menu lateral y el catalogo de permisos que usa el modulo de Identidad para armar roles.
- Si un modulo deja de funcionar como esperas despues de una actualizacion, la pantalla de Modulos es el primer lugar donde revisar su estado (instalado, deshabilitado o con error).

### Alcances y limites

- Runly Core no gestiona datos de negocio (eso lo hacen los demas modulos) — solo administra el sistema en si: que modulos existen, su configuracion global y quien hizo que.
- Instalar, deshabilitar o desinstalar un modulo requiere un permiso especifico de plataforma; pidele a un administrador que te lo asigne si no ves la opcion.
- Los modulos marcados como **core** (como este, Identidad, Archivos, Empresa, Contactos y RRHH) siempre estan instalados y no se pueden desinstalar — son la base minima para operar una instancia de Runly.
