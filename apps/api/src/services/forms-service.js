export class FormsServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "FormsServiceError";
    this.status = status;
  }
}

function notFound(entity) {
  return new FormsServiceError(`${entity} no encontrado.`, 404);
}

export function createFormsService({ prisma }) {
  async function assertFormAssignee({ companyId, userId }) {
    if (!userId) return;
    const membership = await prisma.membership.findFirst({
      where: {
        companyId,
        userId,
        enabled: true,
        user: { enabled: true },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new FormsServiceError(
        "El responsable debe ser un usuario activo de la empresa.",
        422,
      );
    }
  }

  async function listForms({ companyId, siteId }) {
    return prisma.websiteForm.findMany({
      where: { companyId, siteId, enabled: true },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { fields: true, submissions: true } } },
    });
  }

  async function getForm({ companyId, formId }) {
    const form = await prisma.websiteForm.findFirst({
      where: { id: formId, companyId, enabled: true },
      include: { fields: { where: { enabled: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!form) throw notFound("Formulario");
    return form;
  }

  async function createForm({ companyId, siteId, data }) {
    await assertFormAssignee({ companyId, userId: data.defaultAssigneeUserId });
    return prisma.websiteForm.create({
      data: {
        companyId,
        siteId,
        name: data.name,
        description: data.description ?? null,
        submitLabel: data.submitLabel ?? "Enviar",
        successMessage: data.successMessage ?? null,
        notifyEmail: data.notifyEmail ?? null,
        createsLead: data.createsLead ?? true,
        defaultAssigneeUserId: data.defaultAssigneeUserId ?? null,
        honeypotEnabled: data.honeypotEnabled ?? true,
        turnstileRequired: data.turnstileRequired ?? false,
        wizardMode: data.wizardMode ?? false,
      },
    });
  }

  async function updateForm({ companyId, formId, data }) {
    const form = await prisma.websiteForm.findFirst({ where: { id: formId, companyId } });
    if (!form) throw notFound("Formulario");
    await assertFormAssignee({ companyId, userId: data.defaultAssigneeUserId });
    return prisma.websiteForm.update({ where: { id: formId }, data });
  }

  async function listFormAssignees({ companyId }) {
    const memberships = await prisma.membership.findMany({
      where: { companyId, enabled: true, user: { enabled: true } },
      orderBy: { user: { displayName: "asc" } },
      select: { user: { select: { id: true, displayName: true, email: true } } },
    });
    return memberships.map((membership) => membership.user);
  }

  async function softDeleteForm({ companyId, formId }) {
    const form = await prisma.websiteForm.findFirst({ where: { id: formId, companyId } });
    if (!form) throw notFound("Formulario");
    return prisma.websiteForm.update({ where: { id: formId }, data: { enabled: false } });
  }

  async function createFormField({ companyId, formId, data }) {
    const form = await prisma.websiteForm.findFirst({ where: { id: formId, companyId } });
    if (!form) throw notFound("Formulario");
    return prisma.websiteFormField.create({
      data: {
        companyId,
        formId,
        label: data.label,
        name: data.name,
        fieldType: data.fieldType ?? "text",
        semanticKey: data.semanticKey ?? "custom",
        placeholder: data.placeholder ?? null,
        required: data.required ?? false,
        options: data.options ?? null,
        sortOrder: data.sortOrder ?? 0,
        stepNumber: data.stepNumber ?? 1,
        stepTitle: data.stepTitle ?? null,
      },
    });
  }

  async function updateFormField({ companyId, fieldId, data }) {
    const field = await prisma.websiteFormField.findFirst({ where: { id: fieldId, companyId } });
    if (!field) throw notFound("Campo");
    return prisma.websiteFormField.update({ where: { id: fieldId }, data });
  }

  async function softDeleteFormField({ companyId, fieldId }) {
    const field = await prisma.websiteFormField.findFirst({ where: { id: fieldId, companyId } });
    if (!field) throw notFound("Campo");
    return prisma.websiteFormField.update({ where: { id: fieldId }, data: { enabled: false } });
  }

  async function reorderFormFields({ companyId, items }) {
    return prisma.$transaction(
      items.map(({ id, sortOrder }) =>
        prisma.websiteFormField.update({ where: { id, companyId }, data: { sortOrder } }),
      ),
    );
  }

  async function listSubmissions({ companyId, formId, page = 1, pageSize = 20 }) {
    const skip = (page - 1) * pageSize;
    const where = { formId, companyId };
    const [data, total] = await Promise.all([
      prisma.websiteFormSubmission.findMany({ where, orderBy: { submittedAt: "desc" }, skip, take: pageSize }),
      prisma.websiteFormSubmission.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async function deleteSubmission({ companyId, submissionId }) {
    const sub = await prisma.websiteFormSubmission.findFirst({ where: { id: submissionId, companyId } });
    if (!sub) throw notFound("Envio");
    return prisma.websiteFormSubmission.delete({ where: { id: submissionId } });
  }

  return {
    listForms,
    getForm,
    createForm,
    updateForm,
    listFormAssignees,
    softDeleteForm,
    createFormField,
    updateFormField,
    softDeleteFormField,
    reorderFormFields,
    listSubmissions,
    deleteSubmission,
  };
}
