const STATUS_OPTIONS = [
  { value: 'active', label: 'Activo' },
  { value: 'vacation', label: 'Vacaciones' },
  { value: 'inactive', label: 'Inactivo' },
  { value: 'terminated', label: 'Baja' },
]

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Tiempo completo' },
  { value: 'part_time', label: 'Medio tiempo' },
  { value: 'contractor', label: 'Contratista' },
  { value: 'intern', label: 'Becario' },
]

export const HR_EMPLOYEE_FORM = {
  key: 'hr.employee.form',
  kind: 'FORM',
  schema: {
    entity: 'hrEmployee',
    component: 'RunlyForm',
    apiPath: '/hr/employees',
    formMode: 'page',
    showCompletion: true,
    sections: [
      {
        label: 'Identidad',
        icon: 'User',
        fields: [
          { field: 'firstName', label: 'Nombre', type: 'text', required: true },
          { field: 'lastName', label: 'Apellido', type: 'text', required: true },
          { field: 'employeeCode', label: 'Código de colaborador', type: 'text', hint: 'Opcional' },
          { field: 'status', label: 'Estado', type: 'select', required: true, options: STATUS_OPTIONS },
          {
            field: 'userProfileId',
            label: 'Cuenta de usuario vinculada',
            type: 'relation',
            hint: 'Opcional — vincula este colaborador a una cuenta de acceso existente.',
            relation: {
              // Purpose-built endpoint (not /identity/users): already scoped
              // to this company's memberships and pre-labeled server-side
              // (see hr-service.js's listUserOptions) — accepts ?q= (not the
              // default ?search=) for its search term.
              apiPath: '/hr/user-options',
              labelField: 'label',
              searchParam: 'q',
              preload: true,
              clearable: true,
            },
          },
        ],
      },
      {
        label: 'Datos laborales',
        icon: 'Briefcase',
        fields: [
          {
            field: 'jobTitleId',
            label: 'Puesto',
            type: 'relation',
            hint: 'Para crear un puesto nuevo, ve primero a Catálogos de RH.',
            relation: {
              apiPath: '/hr/job-titles',
              labelField: 'name',
              searchParam: 'q',
              preload: true,
              clearable: true,
            },
          },
          {
            field: 'departmentId',
            label: 'Departamento',
            type: 'relation',
            hint: 'Para crear un departamento nuevo, ve primero a Catálogos de RH.',
            relation: {
              apiPath: '/hr/departments',
              labelField: 'name',
              searchParam: 'q',
              preload: true,
              clearable: true,
            },
          },
          {
            field: 'supervisorEmployeeId',
            label: 'Supervisor',
            type: 'relation',
            relation: {
              // /hr/employees accepts both ?search= and ?q=, so the default
              // searchParam works here unlike the three relations above.
              apiPath: '/hr/employees',
              labelField: ['firstName', 'lastName'],
              preload: true,
              clearable: true,
            },
          },
          { field: 'employmentType', label: 'Tipo de contrato', type: 'select', options: EMPLOYMENT_TYPE_OPTIONS },
          { field: 'workLocation', label: 'Ubicación de trabajo', type: 'text', fullWidth: true },
          { field: 'hireDate', label: 'Fecha de ingreso', type: 'date' },
          { field: 'terminationDate', label: 'Fecha de baja', type: 'date' },
        ],
      },
      {
        label: 'Contacto',
        icon: 'Phone',
        fields: [
          { field: 'workEmail', label: 'Correo laboral', type: 'text' },
          { field: 'personalEmail', label: 'Correo personal', type: 'text' },
          { field: 'phone', label: 'Teléfono', type: 'text' },
          { field: 'emergencyContactName', label: 'Contacto de emergencia', type: 'text' },
          { field: 'emergencyContactPhone', label: 'Teléfono de emergencia', type: 'text' },
        ],
      },
      {
        label: 'Notas',
        icon: 'StickyNote',
        collapsible: true,
        defaultCollapsed: true,
        fields: [{ field: 'notesMarkdown', label: 'Notas', type: 'markdown' }],
      },
      {
        id: 'attachments',
        type: 'attachments',
        label: 'Archivos',
        icon: 'Paperclip',
        collapsible: true,
        attachments: {
          listPath: '/files?moduleKey=runly.hr&entityType=HrEmployee&sourceEntityId=:id',
          upload: { endpoint: '/files/upload', moduleKey: 'runly.hr', entityType: 'HrEmployee' },
          removePath: '/files/:docId',
          coverPath: '/files/:docId/cover',
          reorderPath: '/files/reorder',
          signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
          fields: { fileAssetId: 'id', fileName: 'originalName' },
          limits: { maxFiles: 20, maxSizeMB: 10, allowMultiple: true },
          permissions: {
            read: 'hr.employee.read',
            create: 'hr.employee.update',
            remove: 'hr.employee.update',
            fileUpload: 'files.assets.create',
            fileRead: 'files.assets.read',
          },
        },
      },
    ],
    submitLabel: 'Guardar colaborador',
    cancelLabel: 'Cancelar',
  },
}

export default HR_EMPLOYEE_FORM
