export const IDENTITY_ROLE_TABLE = {
  key: "identity.roles.table",
  kind: "TABLE",
  schema: {
    apiPath: "/identity/roles",
    primaryField: "name",
    searchable: true,
    searchPlaceholder: "Buscar rol...",
    columns: [
      { field: "name", label: "Rol", sortable: true, link: true },
      { field: "key", label: "Clave", sortable: false },
      { field: "permissionKeys.length", label: "Permisos", sortable: false },
      {
        field: "enabled",
        label: "Estado",
        type: "select",
        sortable: true,
        options: [
          { value: true, label: "Activo" },
          { value: false, label: "Inactivo" },
        ],
      },
      {
        field: "system",
        label: "Sistema",
        type: "select",
        defaultVisible: false,
        options: [
          { value: true, label: "Sí" },
          { value: false, label: "No" },
        ],
      },
    ],
    filters: [
      {
        key: "enabled",
        label: "Estado",
        type: "select",
        options: [
          { value: "true", label: "Activo" },
          { value: "false", label: "Inactivo" },
        ],
      },
    ],
    emptyState: { message: "No hay roles registrados en esta instancia." },
    rowActions: [{ label: "Ver permisos" }],
  },
};

export default IDENTITY_ROLE_TABLE;
