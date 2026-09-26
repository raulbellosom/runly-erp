// Global record-search providers used by GET /search.
//
// Each provider is permission-gated by the route; `run` is pure data access and
// never sees the Hono context. The first three sources are core Prisma-managed
// tables (not RME3), so model accessors are fine here. The "help" source
// reuses help-service.js (module help system,
// docs/superpowers/specs/2026-09-26-module-help-system-design.md) rather than
// querying Blueprint rows directly, to avoid duplicating the search ranking.
import { createHelpService } from "./help-service.js";

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function contains(q) {
  return { contains: q, mode: "insensitive" };
}

const contactsProvider = {
  source: "contacts",
  label: "Contactos",
  permission: "contacts.contacts.read",
  icon: "ContactRound",
  target: (id) => `/app/m/runly.contacts/contacts/${id}`,
  async run({ prisma, companyId, q, limit }) {
    const rows = await prisma.contact.findMany({
      where: {
        companyId,
        enabled: true,
        OR: [
          { name: contains(q) },
          { legalName: contains(q) },
          { email: contains(q) },
          { phone: contains(q) },
          { taxId: contains(q) },
        ],
      },
      orderBy: { name: "asc" },
      take: limit,
      select: { id: true, name: true, email: true, phone: true, type: true },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: firstNonEmpty(row.email, row.phone, row.type),
      icon: "ContactRound",
    }));
  },
};

const usersProvider = {
  source: "users",
  label: "Usuarios",
  permission: "identity.users.read",
  icon: "Users",
  target: (id) => `/app/m/runly.identity/identity/users/${id}`,
  async run({ prisma, companyId, q, limit }) {
    const rows = await prisma.membership.findMany({
      where: {
        companyId,
        enabled: true,
        user: {
          enabled: true,
          OR: [
            { displayName: contains(q) },
            { email: contains(q) },
            { firstName: contains(q) },
            { lastName: contains(q) },
          ],
        },
      },
      orderBy: { user: { displayName: "asc" } },
      take: limit,
      select: {
        user: {
          select: { id: true, displayName: true, email: true },
        },
      },
    });
    return rows
      .map((row) => row.user)
      .filter(Boolean)
      .map((user) => ({
        id: user.id,
        title: user.displayName,
        subtitle: firstNonEmpty(user.email),
        icon: "Users",
      }));
  },
};

const employeesProvider = {
  source: "employees",
  label: "Empleados",
  permission: "hr.employee.read",
  icon: "UserCheck",
  target: (id) => `/app/m/runly.hr/hr/employees/${id}`,
  async run({ prisma, companyId, q, limit }) {
    const rows = await prisma.hrEmployee.findMany({
      where: {
        companyId,
        enabled: true,
        OR: [
          { firstName: contains(q) },
          { lastName: contains(q) },
          { workEmail: contains(q) },
          { personalEmail: contains(q) },
          { employeeCode: contains(q) },
          { jobTitle: contains(q) },
        ],
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: limit,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        workEmail: true,
        employeeCode: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      title: [row.firstName, row.lastName].filter(Boolean).join(" ").trim(),
      subtitle: firstNonEmpty(row.jobTitle, row.workEmail, row.employeeCode),
      icon: "UserCheck",
    }));
  },
};

const helpProvider = {
  source: "help",
  label: "Ayuda",
  permission: "runly.help.read",
  icon: "BookOpen",
  target: (id) => `/app/help?module=${encodeURIComponent(id)}`,
  async run({ prisma, q, limit }) {
    const helpService = createHelpService({ prisma });
    const results = await helpService.searchHelp(q);
    return results.slice(0, limit).map((r) => ({
      id: r.moduleKey,
      title: r.title,
      subtitle: `${r.moduleName} · ${r.snippet}`.slice(0, 140),
      icon: "BookOpen",
    }));
  },
};

export const SEARCH_PROVIDERS = [
  contactsProvider,
  usersProvider,
  employeesProvider,
  helpProvider,
];
