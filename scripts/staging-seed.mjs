import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function requireStagingSeed(env) {
  if (env.RUNLY_STAGING_ENABLED !== 'true' || env.RUNLY_STAGING_ENVIRONMENT !== 'local'
    || !/^[a-f0-9-]{36}$/.test(env.RUNLY_STAGING_SESSION_ID ?? '') || env.NODE_ENV === 'production') throw Error('STAGING_SEED_LOCAL_ONLY');
  const database = new URL(env.DATABASE_URL);
  if (database.hostname !== 'db' || database.pathname !== '/postgres') throw Error('STAGING_SEED_SESSION_DB_ONLY');
}

// Only synthetic instance data. Standard GoTrue users and normal Runly roles;
// no custom JWT, auth bypass, module privileges or Hub identity mapping.
export async function seedStaging({ prisma, auth, password, env }) {
  requireStagingSeed(env);
  if (!password || password.length < 24) throw Error('STAGING_PASSWORD_REQUIRED');
  const companies = [];
  for (const name of ['A', 'B']) companies.push(await prisma.company.upsert({ where: { slug: `staging-${name.toLowerCase()}` },
    create: { slug: `staging-${name.toLowerCase()}`, name: `Empresa ficticia ${name}` }, update: {} }));
  const adminRole = await prisma.role.findFirst({ where: { key: 'runly.admin', companyId: null } });
  if (!adminRole) throw Error('STAGING_CORE_SEED_REQUIRED');
  const limitedRole = await prisma.role.upsert({ where: { companyId_key: { companyId: companies[0].id, key: 'staging.reader' } },
    create: { companyId: companies[0].id, key: 'staging.reader', name: 'Lector sintético' }, update: {} });
  for (const permission of await prisma.permission.findMany({ where: { key: { in: ['profile.self.read', 'core.modules.read'] } } })) {
    await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: limitedRole.id, permissionId: permission.id } }, create: { roleId: limitedRole.id, permissionId: permission.id }, update: {} });
  }
  const users = {};
  for (const name of ['admin', 'limited', 'other']) {
    const email = `${name}@staging.example.test`;
    const existing = (await auth.admin.listUsers()).data?.users?.find(user => user.email === email);
    const result = existing ? { data: { user: existing } } : await auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error || !result.data?.user) throw Error('STAGING_AUTH_SEED_FAILED');
    const profile = await prisma.userProfile.upsert({ where: { authUserId: result.data.user.id },
      create: { authUserId: result.data.user.id, email, displayName: `Usuario sintético ${name}` }, update: {} });
    const company = name === 'other' ? companies[1] : companies[0];
    await prisma.membership.upsert({ where: { companyId_userId: { companyId: company.id, userId: profile.id } },
      create: { companyId: company.id, userId: profile.id, roleId: name === 'limited' ? limitedRole.id : adminRole.id }, update: {} });
    users[name] = { email, profileId: profile.id, companyId: company.id };
  }
  for (const [key, value] of Object.entries({ initialized: 'true', company_id: companies[0].id, instance_name: 'Runly Staging ficticio' })) {
    await prisma.instanceConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  return { companies: companies.map(c => ({ id: c.id, name: c.name })), users };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireStagingSeed(process.env);
  const { createClient } = createRequire(new URL('../apps/api/package.json', import.meta.url))('@supabase/supabase-js');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try { console.log(JSON.stringify(await seedStaging({ prisma, auth: client.auth, password: process.env.RUNLY_STAGING_PASSWORD, env: process.env }))); }
  finally { await prisma.$disconnect(); }
}
