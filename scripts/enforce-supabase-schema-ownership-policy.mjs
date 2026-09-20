// Guards against a real production incident (2026-09-20): a migration ran
// `ALTER TABLE "realtime"."messages" ENABLE ROW LEVEL SECURITY` and broke
// every fresh install with `ERROR: must be owner of table messages`
// (42501). Verified against a brand-new `supabase start` instance: these
// internal schemas are owned by dedicated admin roles (supabase_realtime_admin,
// supabase_auth_admin, supabase_storage_admin, ...), and the `postgres` role
// used by Prisma migrations is NOT a member of them on self-hosted/CLI-
// provisioned Supabase — so any ALTER TABLE against them (ENABLE/DISABLE ROW
// LEVEL SECURITY, ADD/DROP COLUMN, OWNER TO, ...) fails with the same error.
// CREATE POLICY / ALTER POLICY / DROP POLICY / GRANT / REVOKE on these same
// tables were verified to work fine without ownership — only ALTER TABLE
// itself is the trap, so this only flags that.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.resolve(ROOT, "prisma/migrations");

// Schemas whose objects are owned/managed by Supabase's own admin roles, not
// by the `postgres` role migrations connect as. Add to this list if a future
// migration needs to alter tables in another Supabase-managed schema.
const MANAGED_SCHEMAS = [
  "auth", "storage", "realtime", "vault",
  "net", "cron", "pgsodium", "pgbouncer", "supabase_functions",
];

const ALTER_TABLE_PATTERN = new RegExp(
  `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?"?(${MANAGED_SCHEMAS.join("|")})"?\\s*\\.`,
  "gi",
);

// Escape hatch for a deliberately-verified exception: append this exact
// comment on the same line as the offending statement.
const SUPPRESSION_MARKER = "-- managed-schema-alter-verified-ownership-ok";

function findMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = [];
  for (const entry of fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sqlPath = path.join(MIGRATIONS_DIR, entry.name, "migration.sql");
    if (fs.existsSync(sqlPath)) files.push(sqlPath);
  }
  return files;
}

function findViolations(absPath) {
  const text = fs.readFileSync(absPath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith("--")) continue; // SQL comment, not executable
    // Strip a trailing inline `-- comment` so quoted example SQL in a
    // comment can't accidentally trigger (or suppress) a match.
    const code = line.replace(/--.*$/, "");
    ALTER_TABLE_PATTERN.lastIndex = 0;
    if (ALTER_TABLE_PATTERN.test(code) && !line.includes(SUPPRESSION_MARKER)) {
      violations.push({ line: i + 1, content: line.trim() });
    }
  }
  return violations;
}

const findings = [];
for (const file of findMigrationFiles()) {
  const violations = findViolations(file);
  if (violations.length > 0) {
    findings.push({ file: path.relative(ROOT, file), violations });
  }
}

if (findings.length > 0) {
  console.error(
    "Supabase managed-schema ownership policy violation: ALTER TABLE against "
    + "a Supabase-managed schema requires table ownership that the `postgres` "
    + "migration role does not have on self-hosted/CLI-provisioned instances — "
    + "this WILL fail on every fresh install with `must be owner of table ...` "
    + "(42501). Use CREATE POLICY / ALTER POLICY / DROP POLICY / GRANT / REVOKE "
    + "instead (verified to work without ownership), or add "
    + `"${SUPPRESSION_MARKER}" on the line after re-verifying against a clean `
    + "`supabase start` instance.",
  );
  for (const finding of findings) {
    for (const hit of finding.violations) {
      console.error(`- ${finding.file}:${hit.line} -> ${hit.content}`);
    }
  }
  process.exit(1);
}

console.log("Supabase managed-schema ownership policy check passed.");
