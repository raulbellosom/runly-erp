import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Never reads deployment connection settings. All destructive operations belong
// to this disposable container; its database and password exist only for this run.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const name = `runly-isolation-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const run = (executable, args, options = {}) => {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} failed: ${(result.stderr || result.stdout || '').slice(-4000)}`);
  return result.stdout?.trim() ?? '';
};
let started = false;
try {
  run('docker', ['run', '--rm', '-d', '--name', name, '-p', '127.0.0.1::5432', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:18']);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' });
    if (result.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.');
  const port = run('docker', ['port', name, '5432/tcp']).match(/:(\d+)$/)?.[1];
  if (!port) throw new Error('Unable to resolve disposable database port.');
  const connection = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const env = { ...process.env, DIRECT_URL: connection, DATABASE_URL: connection, RUNLY_ISOLATION_TEST_DATABASE_URL: connection };
  // These minimal contracts model the schemas Supabase creates before Runly's
  // migrations. This does not replace a live Realtime/Auth/Storage smoke test.
  const bootstrap = `
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
    CREATE SCHEMA realtime;
    CREATE TABLE realtime.messages(id bigint, topic text, extension text);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
    GRANT USAGE ON SCHEMA public, auth, realtime TO anon, authenticated, service_role;
    GRANT SELECT, INSERT ON realtime.messages TO anon, authenticated;
    CREATE PUBLICATION supabase_realtime;
  `;
  run('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: bootstrap });
  console.log('Applying all Runly migrations to an empty PostgreSQL 18 database...');
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, stdio: 'inherit' });
  run(process.execPath, ['prisma/seed.js'], { env, stdio: 'inherit' });
  run(process.execPath, ['--test', '--test-reporter=spec', 'apps/api/src/services/__tests__/user-isolation.integration.test.js'], { env, stdio: 'inherit' });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) run('docker', ['stop', name]);
}
