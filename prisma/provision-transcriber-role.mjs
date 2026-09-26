// Aprovisiona (o rota la contraseña de) el rol de PostgreSQL de minimo
// privilegio para el contenedor runly-transcriber — docs/TRANSCRIPTION_SPEC.md
// §5.4. Se ejecuta DENTRO del contenedor de la API, exactamente igual que
// `pnpm db:migrate`/`pnpm db:seed` (`docker run <api-image> pnpm
// db:provision-transcriber-role`), nunca desde el propio proceso de
// infra/installer/setup-*.mjs — ese script no tiene `pg` como dependencia
// (se ejecuta standalone, ver infra/installer/lib/transcriber-db.mjs).
//
// Variables de entorno esperadas (ya presentes via --env-file en la
// invocacion de docker run):
//   DATABASE_URL          — credencial de aplicacion, con privilegio
//                            suficiente para crear roles y otorgar permisos.
//   TRANSCRIBER_DB_PASSWORD — contraseña a asignar/rotar para el rol.
//
// Uso: node prisma/provision-transcriber-role.mjs [--drop]
// `--drop` revoca los privilegios y elimina el rol por completo (usado al
// desactivar TRANSCRIPTION_MODE o al desinstalar la funcion).

import pg from "pg";
import { pathToFileURL } from "node:url";

export const TRANSCRIBER_ROLE_NAME = "runly_transcriber";

export function quoteRolePassword(password) {
  // generateTranscriberPassword() (infra/installer/lib/transcriber-db.mjs)
  // siempre produce base64url ([A-Za-z0-9_-]) — no puede contener una comilla
  // ni una barra invertida. Esta validacion es defensa en profundidad, no
  // solo documentacion: PostgreSQL's CREATE/ALTER ROLE ... PASSWORD exige un
  // literal, no admite un parametro enlazado (confirmado contra una base de
  // datos real).
  if (!/^[A-Za-z0-9_-]+$/.test(password)) {
    throw new Error("TRANSCRIBER_DB_PASSWORD debe ser base64url (sin caracteres que puedan escapar un literal SQL).");
  }
  return `'${password}'`;
}

// Tablas de solo lectura que necesita este rol (ver GRANT SELECT mas abajo).
// La migracion 20260919140000_user_resource_isolation activo RLS en TODAS
// las tablas de `public` que ya existian en ese momento (incluida
// call_recording, call, call_participant, call_guest, user_profile) sin
// crear una politica para cada rol futuro — con RLS activo y sin politica,
// Postgres devuelve 0 filas en silencio a cualquier rol no-superusuario, aun
// con el GRANT SELECT correcto (confirmado contra una base de datos real:
// psql -U postgres veia la fila sin problema por ser superusuario y saltarse
// RLS, mientras runly_transcriber recibia 0 filas y el codigo Python lo
// interpretaba como "grabacion sin archivo"). call_transcript y
// call_transcript_segment nacieron despues de esa migracion, por lo que
// nunca quedaron con RLS activo y no necesitan politica aqui.
const TRANSCRIBER_READ_TABLES = ["call", "call_participant", "call_guest", "call_recording", "user_profile"];

function transcriberSelectPolicyName(table) {
  return `${table}_transcriber_select`;
}

export async function ensureTranscriberRole(pool, password) {
  const literal = quoteRolePassword(password);
  const { rows } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [TRANSCRIBER_ROLE_NAME]);
  if (rows.length) {
    await pool.query(`ALTER ROLE ${TRANSCRIBER_ROLE_NAME} WITH LOGIN PASSWORD ${literal}`);
  } else {
    await pool.query(`CREATE ROLE ${TRANSCRIBER_ROLE_NAME} LOGIN PASSWORD ${literal}`);
  }
  // Supabase no otorga USAGE sobre el esquema `public` a un rol nuevo por
  // defecto — confirmado contra una base de datos real; sin esto, cada tabla
  // devuelve "relation ... does not exist" aunque los GRANT sean correctos.
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${TRANSCRIBER_ROLE_NAME}`);
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON call_transcript, call_transcript_segment TO ${TRANSCRIBER_ROLE_NAME}`,
  );
  // call_transcript_track (V2, pistas por participante): solo lectura — el
  // ciclo de vida de cada pista (STARTING/ACTIVE/.../READY|FAILED) lo escribe
  // exclusivamente call-transcript-service.js via reconciliacion contra
  // LiveKit Egress, nunca este contenedor. Python solo necesita leer
  // object_key/speaker_user_id/speaker_guest_id por pista para descargar y
  // atribuir cada archivo de audio.
  await pool.query(`GRANT SELECT ON call_transcript_track TO ${TRANSCRIBER_ROLE_NAME}`);
  await pool.query(
    `GRANT SELECT ON ${TRANSCRIBER_READ_TABLES.join(", ")} TO ${TRANSCRIBER_ROLE_NAME}`,
  );
  // DROP + CREATE (no "IF NOT EXISTS" — Postgres no lo soporta para POLICY)
  // para que aprovisionar de nuevo (ej. rotacion de password) sea idempotente.
  for (const table of TRANSCRIBER_READ_TABLES) {
    const policy = transcriberSelectPolicyName(table);
    await pool.query(`DROP POLICY IF EXISTS "${policy}" ON ${table}`);
    await pool.query(
      `CREATE POLICY "${policy}" ON ${table} FOR SELECT TO ${TRANSCRIBER_ROLE_NAME} USING (true)`,
    );
  }
}

export async function dropTranscriberRole(pool) {
  // Las politicas deben eliminarse antes que el rol — Postgres no permite
  // DROP ROLE mientras una politica lo siga referenciando en su TO.
  for (const table of TRANSCRIBER_READ_TABLES) {
    await pool.query(`DROP POLICY IF EXISTS "${transcriberSelectPolicyName(table)}" ON ${table}`).catch(() => {});
  }
  await pool.query(
    `REVOKE ALL PRIVILEGES ON call_transcript, call_transcript_segment, call_transcript_track, call, call_participant, call_guest, call_recording, user_profile FROM ${TRANSCRIBER_ROLE_NAME}`,
  ).catch(() => {});
  await pool.query(`REVOKE USAGE ON SCHEMA public FROM ${TRANSCRIBER_ROLE_NAME}`).catch(() => {});
  await pool.query(`DROP ROLE IF EXISTS ${TRANSCRIBER_ROLE_NAME}`);
}

async function main() {
  const shouldDrop = process.argv.includes("--drop");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[provision-transcriber-role] DATABASE_URL no configurado.");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    if (shouldDrop) {
      await dropTranscriberRole(pool);
      console.log(`[provision-transcriber-role] Rol ${TRANSCRIBER_ROLE_NAME} eliminado.`);
      return;
    }
    const password = process.env.TRANSCRIBER_DB_PASSWORD;
    if (!password) {
      console.error("[provision-transcriber-role] TRANSCRIBER_DB_PASSWORD no configurado.");
      process.exit(1);
    }
    await ensureTranscriberRole(pool, password);
    console.log(`[provision-transcriber-role] Rol ${TRANSCRIBER_ROLE_NAME} aprovisionado (privilegio mínimo, ver docs/TRANSCRIPTION_SPEC.md §5.4).`);
  } finally {
    await pool.end();
  }
}

// Solo ejecuta el CLI cuando se invoca directamente (node prisma/provision-transcriber-role.mjs)
// — importar este modulo desde una prueba no debe conectarse a ninguna base de datos.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error("[provision-transcriber-role] Error:", error?.message ?? error);
    process.exit(1);
  });
}
