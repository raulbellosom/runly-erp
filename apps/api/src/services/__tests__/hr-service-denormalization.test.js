// apps/api/src/services/__tests__/hr-service-denormalization.test.js
//
// Server-side department/jobTitle/managerName resolution and tenureLabel,
// added for the HR employee blueprint migration (see
// docs/superpowers/specs/2026-09-15-hr-employee-blueprint-migration-design.md).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHrService } from '../hr-service.js'

const COMPANY_ID = 'company-1'
const EMPLOYEE_ID = 'emp-1'
const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111'
const JOB_TITLE_ID = '22222222-2222-4222-8222-222222222222'
const SUPERVISOR_ID = '33333333-3333-4333-8333-333333333333'

// Synthetic directory covering every hrEmployee.findFirst call site
// updateEmployee's happy path touches: assertEmployee (id=EMPLOYEE_ID),
// assertSupervisor/assertNoHierarchyCycle/resolveDenormalizedFields
// (id=SUPERVISOR_ID), and the employeeCode conflict check (no matching id
// at all in these tests, since no employeeCode is sent).
const EMPLOYEE_DIRECTORY = {
  [EMPLOYEE_ID]: { id: EMPLOYEE_ID, companyId: COMPANY_ID, firstName: 'Juan', lastName: 'Pérez', supervisorEmployeeId: null },
  [SUPERVISOR_ID]: { id: SUPERVISOR_ID, companyId: COMPANY_ID, firstName: 'Ana', lastName: 'López', supervisorEmployeeId: null },
}

function buildPrisma() {
  return {
    userProfile: { findUnique: async () => ({ id: 'profile-1' }) },
    membership: { findFirst: async () => ({ companyId: COMPANY_ID }) },
    hrDepartment: {
      findFirst: async ({ where }) =>
        where.id === DEPARTMENT_ID ? { id: DEPARTMENT_ID, name: 'Ingeniería', enabled: true } : null,
    },
    hrJobTitle: {
      findFirst: async ({ where }) =>
        where.id === JOB_TITLE_ID ? { id: JOB_TITLE_ID, name: 'Desarrollador', enabled: true } : null,
    },
    hrEmployee: {
      findFirst: async ({ where }) => {
        if (typeof where.id === 'string') return EMPLOYEE_DIRECTORY[where.id] ?? null;
        return null; // employeeCode conflict check (where.id = { not: ... }) — no conflicts in these tests
      },
      findUnique: async () => ({ id: EMPLOYEE_ID, companyId: COMPANY_ID }),
      update: async ({ data }) => ({ id: EMPLOYEE_ID, ...data }),
    },
    fileAsset: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    auditLog: { create: async () => ({}) },
  }
}

describe('hr-service department/jobTitle/managerName server-side resolution', () => {
  it('updateEmployee resolves department name from departmentId', async () => {
    const service = createHrService({
      prisma: buildPrisma(),
      activityBridge: { logAndPublish: async () => {} },
    })
    const result = await service.updateEmployee({
      authUserId: 'auth-1',
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
      payload: { firstName: 'Juan', lastName: 'Pérez', departmentId: DEPARTMENT_ID },
    })
    assert.equal(result.department, 'Ingeniería')
  })

  it('updateEmployee resolves jobTitle name from jobTitleId', async () => {
    const service = createHrService({
      prisma: buildPrisma(),
      activityBridge: { logAndPublish: async () => {} },
    })
    const result = await service.updateEmployee({
      authUserId: 'auth-1',
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
      payload: { firstName: 'Juan', lastName: 'Pérez', jobTitleId: JOB_TITLE_ID },
    })
    assert.equal(result.jobTitle, 'Desarrollador')
  })

  it("updateEmployee resolves managerName as 'FirstName LastName' from supervisorEmployeeId", async () => {
    const service = createHrService({
      prisma: buildPrisma(),
      activityBridge: { logAndPublish: async () => {} },
    })
    const result = await service.updateEmployee({
      authUserId: 'auth-1',
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
      payload: { firstName: 'Juan', lastName: 'Pérez', supervisorEmployeeId: SUPERVISOR_ID },
    })
    assert.equal(result.managerName, 'Ana López')
  })

  it('updateEmployee clears department when departmentId is explicitly set to null', async () => {
    const service = createHrService({
      prisma: buildPrisma(),
      activityBridge: { logAndPublish: async () => {} },
    })
    const result = await service.updateEmployee({
      authUserId: 'auth-1',
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
      payload: { firstName: 'Juan', lastName: 'Pérez', departmentId: null },
    })
    assert.equal(result.department, null)
  })

  it('updateEmployee leaves department untouched when departmentId is absent from the payload', async () => {
    const service = createHrService({
      prisma: buildPrisma(),
      activityBridge: { logAndPublish: async () => {} },
    })
    const result = await service.updateEmployee({
      authUserId: 'auth-1',
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
      payload: { firstName: 'Juan', lastName: 'Pérez' },
    })
    assert.equal('department' in result, false)
  })
})

describe('hr-service getEmployee tenureLabel', () => {
  it('computes a Spanish tenure label from hireDate', async () => {
    const hireDate = new Date()
    hireDate.setFullYear(hireDate.getFullYear() - 3)
    hireDate.setMonth(hireDate.getMonth() - 2)
    const prisma = buildPrisma()
    prisma.hrEmployee.findFirst = async () => ({
      id: EMPLOYEE_ID,
      companyId: COMPANY_ID,
      hireDate,
      supervisor: null,
      reportees: [],
      departmentRef: null,
      jobTitleRef: null,
      userProfile: null,
    })
    const service = createHrService({ prisma, activityBridge: { logAndPublish: async () => {} } })
    const result = await service.getEmployee({
      authUserId: 'auth-1',
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
    })
    assert.equal(result.tenureLabel, '3 años y 2 meses')
  })

  it('returns null tenureLabel when there is no hireDate', async () => {
    const prisma = buildPrisma()
    prisma.hrEmployee.findFirst = async () => ({
      id: EMPLOYEE_ID,
      companyId: COMPANY_ID,
      hireDate: null,
      supervisor: null,
      reportees: [],
      departmentRef: null,
      jobTitleRef: null,
      userProfile: null,
    })
    const service = createHrService({ prisma, activityBridge: { logAndPublish: async () => {} } })
    const result = await service.getEmployee({
      authUserId: 'auth-1',
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
    })
    assert.equal(result.tenureLabel, null)
  })
})
