# Privacidad del repositorio público

Toda documentación, ejemplo, plan, prueba y nota de verificación debe poder
compartirse sin identificar una instalación real o sus usuarios.

- Usar `example.com`, `.example`, `.test` o `.invalid` para dominios ficticios.
- Usar `192.0.2.0/24`, `198.51.100.0/24` o `203.0.113.0/24` para IP de ejemplo.
- Guardar direcciones, correos personales, credenciales y rutas reales en un
  gestor privado o en `.env` ignorados. `docs/private/` también queda ignorado.
- No pegar salidas reales de producción, URLs firmadas, tokens ni volcados en
  documentación, issues, capturas o informes. Describir el resultado sin esos datos.
- Las identidades de paquetes, enlaces públicos del proyecto y atribución de marca
  se conservan. No son destinos de conexión a la infraestructura privada.

## Comprobaciones

`pnpm check:privacy` revisa archivos versionados y nuevos no ignorados. Detecta
IP ajenas a los rangos de ejemplo, dominios de infraestructura, dominios retirados,
correos personales, rutas de usuario y archivos privados. Solo muestra archivo,
línea y categoría; nunca imprime el valor detectado.

`pnpm check:secrets` añade [Gitleaks](https://github.com/gitleaks/gitleaks) instalado
en `PATH`. Escanea una copia temporal de los archivos publicables, sin incluir los
`.env` locales ignorados. CI ejecuta ambas comprobaciones y revisa también el historial.
Las excepciones de Gitleaks se limitan a tres marcadores literales de documentación.

Para bloquear commits localmente, instalar Gitleaks y activar el hook:

```bash
git config core.hooksPath .githooks
```

El hook examina el contenido preparado en el índice, incluso si el archivo de
trabajo fue corregido después de `git add`. Si ya usas otros hooks, integra el
comando `node scripts/check-repository-privacy.mjs --staged --secrets` en ellos.

La política es una ayuda, no una garantía de ausencia de datos sensibles. No
inspecciona texto dentro de imágenes, archivos comprimidos ni todos los posibles
formatos de secretos. Las nuevas excepciones requieren revisar el valor y su uso;
no excluir carpetas enteras de documentación o pruebas.

## Revisión de septiembre de 2026

Se sustituyeron direcciones de servidores, dominios de administración y clientes,
un correo personal y rutas de estaciones de trabajo por ejemplos. Se retiraron
destinos reales por defecto de scripts de desarrollo, reparación de Storage,
host móvil y enlaces de reanudación del chat. Los scripts SSH requieren variables
del entorno; véase [configuración de desarrollo](06_deployment_strategy.md).

El análisis local de Gitleaks recorrió 2667 commits alcanzables y aproximadamente
53 MB de cambios. Sus tres alertas iniciales eran marcadores de ejemplo
(`ATLAS_TOKEN` e `invalid-token`), no credenciales reales identificadas.
El análisis del contenido actual tampoco detectó secretos con sus reglas.
La comparación exacta de 23 valores de credenciales de la configuración local
con los archivos versionados no encontró coincidencias. Pasaron 74 pruebas de
privacidad, direcciones de sitios, imágenes, llamadas y configuración del host
nativo, además del lint de los archivos JavaScript modificados. Los scripts SSH
rechazan configuración ausente antes de conectarse, tanto en Bash como PowerShell.

React Doctor informó 16 advertencias en el conjunto de cambios del workspace,
incluida una sobre un iframe de PDF sin `sandbox`; no es un hallazgo de exposición
de infraestructura y requiere una revisión funcional separada. No se desplegó ni
se probó contra servidores reales durante esta limpieza.

Esta limpieza cambia los archivos actuales. Las direcciones y los datos personales
anteriores siguen en el historial de Git y pueden existir en clones, forks y cachés.
No se reescribió el historial ni se publicó esta limpieza automáticamente.
Si se necesita retirar esos datos del historial, hay que preparar una reescritura
coordinada de ramas y etiquetas y gestionar las copias externas. Si se identifica
una credencial real expuesta, revocarla o rotarla antes de limpiar el historial.
