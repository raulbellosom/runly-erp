const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Tiempo completo' },
  { value: 'part_time', label: 'Medio tiempo' },
  { value: 'contractor', label: 'Contratista' },
  { value: 'intern', label: 'Becario' },
]

const STATUS_LABEL_MAP = {
  active: 'Activo',
  vacation: 'Vacaciones',
  inactive: 'Inactivo',
  terminated: 'Baja',
}

export const HR_EMPLOYEE_DETAIL = {
  key: 'hr.employee.detail',
  kind: 'DETAIL',
  schema: {
    entity: 'hrEmployee',
    component: 'RunlyDetail',
    apiPath: '/hr/employees',
    layout: 'two-column',
    hero: {
      titleField: 'firstName',
      subtitleFields: ['jobTitle', 'department'],
      statusField: 'status',
      statusMap: STATUS_LABEL_MAP,
      imageDocsPath: '/files?moduleKey=runly.hr&entityType=HrEmployee&sourceEntityId=:id',
      fallbackIcon: 'User',
      metaChips: [
        { field: 'employeeCode', label: 'Código', icon: 'Hash' },
        { field: 'employmentType', label: 'Tipo', icon: 'Briefcase', type: 'select', options: EMPLOYMENT_TYPE_OPTIONS },
      ],
    },
    kpis: [
      { label: 'Antigüedad', field: 'tenureLabel', icon: 'Clock' },
      { label: 'Fecha de ingreso', field: 'hireDate', type: 'date', icon: 'Calendar' },
      { label: 'Fecha de baja', field: 'terminationDate', type: 'date', icon: 'Calendar' },
    ],
    sections: [
      {
        label: 'Datos laborales',
        icon: 'Briefcase',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'jobTitle', label: 'Puesto', icon: 'Briefcase' },
          { field: 'department', label: 'Departamento', icon: 'Building2' },
          { field: 'employmentType', label: 'Tipo de contrato', icon: 'Briefcase', type: 'select', options: EMPLOYMENT_TYPE_OPTIONS },
          { field: 'workLocation', label: 'Ubicación de trabajo', icon: 'MapPin' },
          { field: 'hireDate', label: 'Fecha de ingreso', type: 'date', icon: 'Calendar' },
          { field: 'terminationDate', label: 'Fecha de baja', type: 'date', icon: 'Calendar' },
        ],
      },
      {
        label: 'Contacto',
        icon: 'Phone',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'workEmail', label: 'Correo laboral', icon: 'Mail' },
          { field: 'personalEmail', label: 'Correo personal', icon: 'Mail' },
          { field: 'phone', label: 'Teléfono', icon: 'Phone' },
          { field: 'emergencyContactName', label: 'Contacto de emergencia', icon: 'Phone' },
          { field: 'emergencyContactPhone', label: 'Teléfono de emergencia', icon: 'Phone' },
        ],
      },
      {
        label: 'Notas',
        icon: 'StickyNote',
        column: 'main',
        fields: [{ field: 'notesMarkdown', label: 'Notas', type: 'markdown', icon: 'FileText' }],
      },
      {
        id: 'linked-user',
        type: 'relation-card',
        label: 'Cuenta de usuario vinculada',
        icon: 'UserCheck',
        column: 'aside',
        relationCard: {
          idField: 'userProfile.id',
          titleField: 'userProfile.displayName',
          subtitleFields: ['userProfile.email'],
          avatarField: 'userProfile.avatarFileId',
          fallbackTitle: 'Sin cuenta de usuario vinculada.',
          hrefTemplate: '/app/m/runly.identity/identity/users/:id',
          icon: 'UserCheck',
        },
      },
      {
        id: 'org-chart',
        type: 'component',
        label: 'Organigrama',
        icon: 'Users',
        column: 'aside',
        component: 'runly.hr:OrgChartSection',
      },
      {
        id: 'attachments',
        type: 'attachments',
        label: 'Archivos',
        icon: 'Paperclip',
        column: 'aside',
        attachments: {
          listPath: '/files?moduleKey=runly.hr&entityType=HrEmployee&sourceEntityId=:id',
          upload: { endpoint: '/files/upload', moduleKey: 'runly.hr', entityType: 'HrEmployee' },
          removePath: '/files/:docId',
          coverPath: '/files/:docId/cover',
          reorderPath: '/files/reorder',
          signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
          fields: { fileAssetId: 'id', fileName: 'originalName' },
          permissions: {
            read: 'hr.employee.read',
            create: 'hr.employee.update',
            remove: 'hr.employee.update',
            fileUpload: 'files.assets.create',
            fileRead: 'files.assets.read',
          },
        },
      },
      {
        id: 'assigned-equipment',
        type: 'component',
        label: 'Equipos asignados',
        icon: 'Boxes',
        column: 'aside',
        component: 'runly.hr:AssignedEquipmentSection',
      },
      {
        id: 'history',
        type: 'component',
        label: 'Actividad',
        icon: 'History',
        column: 'aside',
        component: 'runly.hr:HistorySection',
      },
    ],
  },
}

export default HR_EMPLOYEE_DETAIL
