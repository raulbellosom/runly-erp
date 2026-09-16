export const IDENTITY_USER_TABLE = {
  key: "identity.users.table",
  kind: "TABLE",
  schema: {
    apiPath: "/identity/users",
    primaryField: "displayName",
    searchable: true,
    searchPlaceholder: "Buscar usuario...",
    columns: [
      { field: "avatarUrl", label: "Foto", type: "image", sortable: false },
      { field: "displayName", label: "Usuario", sortable: true, link: true },
      { field: "email", label: "Correo", sortable: true },
      { field: "memberships.0.roleName", label: "Rol", sortable: false },
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
      { field: "createdAt", label: "Creado", type: "date", sortable: true },
      { field: "firstName", label: "Nombre", defaultVisible: false },
      { field: "lastName", label: "Apellidos", defaultVisible: false },
      { field: "phone", label: "Telefono", defaultVisible: false },
      {
        field: "gender",
        label: "Sexo",
        defaultVisible: false,
        type: "select",
        options: [
          { value: "male", label: "Masculino" },
          { value: "female", label: "Femenino" },
          { value: "other", label: "Otro" },
        ],
      },
      { field: "birthDate", label: "Fecha nacimiento", type: "date", defaultVisible: false },
      { field: "country", label: "Pais", defaultVisible: false },
      { field: "state", label: "Estado/Provincia", defaultVisible: false },
      { field: "city", label: "Ciudad", defaultVisible: false },
      { field: "colony", label: "Colonia", defaultVisible: false },
      { field: "street", label: "Calle", defaultVisible: false },
      { field: "postalCode", label: "Codigo postal", defaultVisible: false },
      { field: "bio", label: "Bio", defaultVisible: false },
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
    emptyState: { message: "No hay usuarios registrados." },
    rowActions: [
      { label: "Ver detalle" },
      { label: "Editar" },
      { label: "Eliminar" },
    ],
  },
};

export default IDENTITY_USER_TABLE;
