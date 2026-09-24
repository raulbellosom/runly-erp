import crypto from "node:crypto";

// Rol de PostgreSQL de minimo privilegio para el contenedor runly-transcriber
// (docs/TRANSCRIPTION_SPEC.md §5.4). Solo las utilidades PURAS (sin
// dependencia de `pg`) viven aqui, porque infra/installer/ no tiene
// dependencias npm propias (se ejecuta standalone via bootstrap-local.sh) —
// la ejecucion real del SQL (CREATE ROLE/GRANT) vive en
// prisma/provision-transcriber-role.mjs, que corre DENTRO del contenedor de
// la API (donde `pg` si esta disponible), invocado igual que
// `pnpm db:migrate`/`pnpm db:seed`.
export const TRANSCRIBER_ROLE_NAME = "runly_transcriber";

export function generateTranscriberPassword(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString("base64url");
}

// Construye la cadena de conexion TRANSCRIBER_DATABASE_URL a partir de la
// DATABASE_URL de la aplicacion (mismo host/puerto/base de datos, credencial
// distinta) — evita duplicar la logica de parseo de host/puerto en cada
// script de instalacion.
export function buildTranscriberDatabaseUrl(databaseUrl, password) {
  const url = new URL(databaseUrl);
  url.username = TRANSCRIBER_ROLE_NAME;
  url.password = password;
  return url.toString();
}
