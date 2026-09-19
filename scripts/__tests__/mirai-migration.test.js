import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

// Explicit integration opt-in: creates its own network-isolated, disposable DB.
// Never reads .env, DATABASE_URL, Supabase credentials, or host database volumes.
// Run: RUN_MIRAI_MIGRATION_TEST=1 node --test scripts/__tests__/mirai-migration.test.js
const enabled = process.env.RUN_MIRAI_MIGRATION_TEST === '1';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = read('prisma/migrations/20260919130000_chat_mirai_rename/migration.sql');
const history = [
  '20260907010000_chat_meridian', '20260907020000_chat_meridian_conv_unique',
  '20260907030000_chat_meridian_route', '20260907040000_chat_meridian_surface',
  '20260907050000_chat_meridian_panel',
].map(name => read(`prisma/migrations/${name}/migration.sql`)).join('\n');

test('MirAI migration preserves persisted identity in isolated PostgreSQL', {
  skip: !enabled && 'Set RUN_MIRAI_MIGRATION_TEST=1 to run isolated Docker integration',
  timeout: 120_000,
}, async t => {
  const container = `runly-mirai-migration-${process.pid}-${Date.now()}`;
  const docker = (args, input) => spawnSync('docker', args, {
    input, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  const run = docker(['run', '--detach', '--name', container, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    'postgres:18-alpine']);
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  t.after(() => {
    const removed = docker(['rm', '--force', '--volumes', container]);
    assert.equal(removed.status, 0, removed.stderr);
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (docker(['exec', container, 'pg_isready', '-U', 'postgres']).status === 0) {
      ready = true;
      break;
    }
    await delay(250);
  }
  assert.ok(ready, 'Disposable PostgreSQL must become ready');
  const exec = sql => docker(['exec', '-i', container, 'psql', '-X', '-qAt',
    '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], sql);
  const sql = text => {
    const result = exec(text);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  const json = query => JSON.parse(sql(`SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM (${query}) r;`));
  const rows = table => json(`SELECT * FROM ${table} ORDER BY id`);
  const reject = (query, error) => {
    const result = exec(query);
    assert.notEqual(result.status, 0, 'Expected database constraint rejection');
    assert.match(result.stderr, error);
  };
  sql('CREATE ROLE migration_reader;');

  function fixture(companyColumn = false) {
    sql(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      CREATE TABLE company (id uuid PRIMARY KEY DEFAULT uuidv7());
      CREATE TABLE user_profile (
        id uuid PRIMARY KEY DEFAULT uuidv7(), auth_user_id uuid,
        display_name text, first_name text, last_name text, email text UNIQUE,
        enabled boolean DEFAULT true, updated_at timestamptz DEFAULT now()
        ${companyColumn ? ', company_id uuid REFERENCES company(id)' : ''}
      );
      CREATE TABLE membership (
        id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid REFERENCES company(id),
        user_id uuid REFERENCES user_profile(id), enabled boolean DEFAULT true,
        updated_at timestamptz DEFAULT now(), UNIQUE(company_id, user_id)
      );
      CREATE TABLE chat_conversations (
        id uuid PRIMARY KEY DEFAULT uuidv7(), type text NOT NULL,
        created_by_user_id uuid REFERENCES user_profile(id), deleted_at timestamptz,
        CONSTRAINT chat_conversations_type_check CHECK(type IN ('direct','group','channel','external_support'))
      );
      CREATE TABLE chat_messages (
        id uuid PRIMARY KEY DEFAULT uuidv7(), conversation_id uuid REFERENCES chat_conversations(id),
        sender_profile_id uuid REFERENCES user_profile(id), sender_type text, content text,
        CONSTRAINT chat_messages_sender_type_check CHECK(sender_type IN ('user','guest','system'))
      );
      CREATE TABLE permission (id uuid PRIMARY KEY DEFAULT uuidv7(), key text UNIQUE, name text, description text);
      CREATE TABLE role_permission (id uuid PRIMARY KEY DEFAULT uuidv7(), role_id uuid,
        permission_id uuid REFERENCES permission(id), UNIQUE(role_id, permission_id));
      CREATE TABLE user_permission_grant (id uuid PRIMARY KEY DEFAULT uuidv7(), user_id uuid REFERENCES user_profile(id),
        company_id uuid REFERENCES company(id), permission_id uuid REFERENCES permission(id),
        UNIQUE(user_id, company_id, permission_id));
      ${history}
      INSERT INTO company DEFAULT VALUES;
      INSERT INTO company DEFAULT VALUES;
      INSERT INTO user_profile (display_name, first_name, last_name, email, is_bot ${companyColumn ? ', company_id' : ''})
        SELECT 'MeridIAn', 'MeridIAn', '', 'meridian+' || id || '@bots.runly.local', true ${companyColumn ? ', id' : ''} FROM company;
      INSERT INTO user_profile (display_name, email, is_bot) VALUES
        ('Meridian human', 'meridian+human@bots.runly.local', false),
        ('Other bot', 'other@bots.runly.local', true);
      INSERT INTO membership (company_id, user_id)
        SELECT c.id, u.id FROM company c JOIN user_profile u ON u.email = 'meridian+' || c.id || '@bots.runly.local';
      INSERT INTO chat_conversations (type, created_by_user_id)
        SELECT 'meridian', id FROM user_profile WHERE is_bot = false;
      INSERT INTO chat_conversations (type, created_by_user_id, deleted_at)
        SELECT 'meridian', id, now() FROM user_profile WHERE is_bot = false;
      INSERT INTO chat_conversations (type, created_by_user_id)
        SELECT 'group', id FROM user_profile WHERE is_bot = false;
      INSERT INTO chat_messages (conversation_id, sender_profile_id, sender_type, content)
        SELECT c.id, u.id, 'assistant', 'Historical answer: MeridIAn' FROM chat_conversations c
        CROSS JOIN user_profile u WHERE c.deleted_at IS NULL AND c.type = 'meridian' AND u.email LIKE 'meridian+%@bots.runly.local' AND u.is_bot;
      INSERT INTO permission (key, name, description) VALUES ('chat.meridian.use', 'Usar MeridIAn', 'Old description');
      INSERT INTO role_permission (role_id, permission_id) SELECT uuidv7(), id FROM permission;
      INSERT INTO user_permission_grant (user_id, company_id, permission_id)
        SELECT m.user_id, m.company_id, p.id FROM membership m CROSS JOIN permission p;
      INSERT INTO chat_meridian_run (company_id, conversation_id, actor_profile_id, trigger_message_id, model, tool_calls, route, surface)
        SELECT m.company_id, c.id, m.user_id, msg.id, 'fixture-model', '[{"name":"history"}]', 'simple', 'direct'
        FROM membership m CROSS JOIN chat_conversations c JOIN chat_messages msg ON msg.conversation_id = c.id LIMIT 1;
      INSERT INTO chat_meridian_thread (company_id, owner_profile_id, host_conversation_id)
        SELECT company_id, user_id, c.id FROM membership CROSS JOIN chat_conversations c WHERE c.type = 'group';
      INSERT INTO chat_meridian_message (thread_id, role, content)
        SELECT id, 'assistant', 'Historical panel answer' FROM chat_meridian_thread;
      ALTER TABLE chat_meridian_thread ENABLE ROW LEVEL SECURITY;
      CREATE POLICY panel_reader ON chat_meridian_thread FOR SELECT TO migration_reader USING (enabled);
      GRANT SELECT ON chat_meridian_thread, chat_meridian_message TO migration_reader;
    `);
  }

  for (const companyColumn of [false, true]) {
    await t.test(`preserves records, grants, history, constraints and retries (company_id=${companyColumn})`, async () => {
      fixture(companyColumn);
      const tables = ['user_profile', 'membership', 'chat_conversations', 'chat_messages', 'permission',
        'role_permission', 'user_permission_grant', 'chat_meridian_run', 'chat_meridian_thread', 'chat_meridian_message'];
      const before = Object.fromEntries(tables.map(table => [table, rows(table)]));
      const oldIndexes = json("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname LIKE '%meridian%' ORDER BY indexname");
      sql(migration);
      for (const table of tables) {
        const expected = structuredClone(before[table]);
        for (const row of expected) {
          if (table === 'user_profile' && row.is_bot && /^meridian\+.*@bots\.runly\.local$/.test(row.email)) {
            Object.assign(row, { display_name: 'MirAI', first_name: 'MirAI', last_name: '', email: row.email.replace(/^meridian\+/, 'mirai+') });
          }
          if (table === 'chat_conversations' && row.type === 'meridian') row.type = 'mirai';
          if (table === 'permission') Object.assign(row, { key: 'chat.mirai.use', name: 'Usar MirAI',
            description: 'Permite conversar con el asistente de IA MirAI dentro del chat.' });
        }
        assert.deepEqual(rows(table.replace('meridian', 'mirai')), expected, `${table}: preserve IDs and data`);
      }
      const snapshot = () => tables.map(table => rows(table.replace('meridian', 'mirai')));
      const first = snapshot();
      sql(migration);
      assert.deepEqual(snapshot(), first, 'Second application must not change any row');
      assert.deepEqual(json("SELECT conname, contype FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conname LIKE '%meridian%' ORDER BY conname"), []);
      assert.equal(sql("SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%meridian%'"), '0');
      assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%meridian%'"), '0');
      assert.deepEqual(json("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname LIKE '%mirai%' ORDER BY indexname"),
        oldIndexes.map(index => ({ indexname: index.indexname.replaceAll('meridian', 'mirai'), indexdef: index.indexdef.replaceAll('meridian', 'mirai') })),
        'Index columns, ordering, uniqueness and predicates must survive the rename');
      assert.equal(sql("SELECT has_table_privilege('migration_reader','chat_mirai_thread','SELECT') AND has_table_privilege('migration_reader','chat_mirai_message','SELECT')"), 't');
      assert.equal(sql("SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='chat_mirai_thread'"), 't');
      assert.equal(sql("SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='chat_mirai_thread' AND policyname='panel_reader'"), '1');
      reject("INSERT INTO chat_conversations (type) VALUES ('meridian');", /chat_conversations_type_check/);
      reject("INSERT INTO chat_conversations (type, created_by_user_id) SELECT 'mirai', created_by_user_id FROM chat_conversations WHERE type='mirai' AND deleted_at IS NULL;", /chat_conversations_one_mirai_per_user_idx/);
      sql("BEGIN; INSERT INTO chat_conversations (type, created_by_user_id, deleted_at) SELECT 'mirai', created_by_user_id, now() FROM chat_conversations WHERE type='mirai' AND deleted_at IS NULL; ROLLBACK;");
      reject("INSERT INTO chat_mirai_thread (owner_profile_id, host_conversation_id) SELECT owner_profile_id, host_conversation_id FROM chat_mirai_thread LIMIT 1;", /chat_mirai_thread_owner_host_idx/);
      reject("INSERT INTO chat_mirai_message (thread_id, role, content) VALUES (uuidv7(), 'assistant', 'invalid');", /chat_mirai_message_thread_id_fkey/);
      assert.equal(sql('BEGIN; DELETE FROM chat_mirai_thread; SELECT count(*) FROM chat_mirai_message; ROLLBACK;'), '0');
      if (companyColumn) reject("INSERT INTO user_profile (email,is_bot,company_id) SELECT 'duplicate@example.local',true,company_id FROM user_profile WHERE company_id IS NOT NULL LIMIT 1;", /user_profile_mirai_bot_per_company_idx/);

      // Run the actual bot provisioning block twice, with its SQL executed only in this container.
      const source = read('prisma/seed.js');
      const start = source.indexOf('  try {', source.indexOf('// MirAI bot profile'));
      const end = source.indexOf('\n}', start);
      assert.ok(start > 0 && end > start, 'Locate the production bot provisioning block');
      const literal = value => `'${String(value).replaceAll("'", "''")}'`;
      const query = (parts, ...values) => parts.reduce((text, part, index) => text + part + (index < values.length ? literal(values[index]) : ''), '');
      const prisma = {
        company: { findMany: async () => rows('company') },
        $queryRaw: async (parts, ...values) => {
          const statement = query(parts, ...values);
          if (/^\s*SELECT/i.test(statement)) return json(statement);
          return json(`WITH inserted AS (${statement}) SELECT * FROM inserted`);
        },
        $executeRaw: async (parts, ...values) => sql(query(parts, ...values)),
      };
      const provision = new (Object.getPrototypeOf(async function () {}).constructor)('prisma', 'console', source.slice(start, end));
      let successfulRuns = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) await provision(prisma, { log: () => { successfulRuns += 1; } });
      assert.equal(successfulRuns, 2, 'Seed must reach success, not swallow an error');
      assert.deepEqual(snapshot(), first, 'Seed reruns must not duplicate or modify bots or memberships');
    });
  }

  await t.test('a late migration failure rolls back earlier data and schema changes', () => {
    fixture();
    const before = rows('chat_conversations');
    sql(`CREATE FUNCTION reject_bot_rename() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected migration failure'; END $$;
      CREATE TRIGGER reject_bot_rename BEFORE UPDATE ON user_profile FOR EACH ROW EXECUTE FUNCTION reject_bot_rename();`);
    reject(migration, /injected migration failure/);
    assert.deepEqual(rows('chat_conversations'), before, 'Conversation type update must roll back');
    assert.equal(sql("SELECT to_regclass('chat_conversations_one_meridian_per_user_idx') IS NOT NULL"), 't');
    assert.equal(sql("SELECT to_regclass('chat_conversations_one_mirai_per_user_idx') IS NULL"), 't');
    assert.match(sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chat_conversations_type_check'"), /meridian/);
    sql('DROP TRIGGER reject_bot_rename ON user_profile;');
    sql(migration);
  });

  await t.test('coexisting permission identities fail without stranding existing grants', () => {
    fixture();
    sql("INSERT INTO permission (key,name) VALUES ('chat.mirai.use','Already provisioned');");
    const before = rows('permission');
    const conversations = rows('chat_conversations');
    const result = exec(migration);
    assert.notEqual(result.status, 0, 'Ambiguous existing permission identities must fail explicitly');
    assert.deepEqual(rows('permission'), before);
    assert.deepEqual(rows('chat_conversations'), conversations);
    assert.equal(sql("SELECT count(*) FROM role_permission r JOIN permission p ON p.id=r.permission_id WHERE p.key='chat.meridian.use'"), '1');
  });
});
