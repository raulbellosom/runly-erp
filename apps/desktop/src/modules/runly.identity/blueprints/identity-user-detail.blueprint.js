const ENABLED_STATUS_MAP = { true: "Activo", false: "Inactivo" };

export const IDENTITY_USER_DETAIL = {
  key: "identity.user.detail",
  kind: "DETAIL",
  schema: {
    entity: "identityUser",
    component: "RunlyDetail",
    apiPath: "/identity/users",
    layout: "two-column",
    hero: {
      titleField: "displayName",
      subtitleFields: ["email"],
      statusField: "enabled",
      statusMap: ENABLED_STATUS_MAP,
      avatarUserField: "id",
      fallbackIcon: "UserRound",
      metaChips: [{ field: "phone", label: "Teléfono", icon: "Phone" }],
    },
    kpis: [
      { label: "Estado", field: "enabled", type: "select", options: [{ value: true, label: "Activo" }, { value: false, label: "Inactivo" }], icon: "CircleCheck" },
      { label: "Rol principal", field: "memberships.0.roleName", icon: "Shield" },
      { label: "Empresas asignadas", field: "membershipsTotal", icon: "Building2" },
      { label: "Fecha de alta", field: "createdAt", type: "date", icon: "Calendar" },
    ],
    sections: [
      {
        label: "Información personal",
        icon: "UserRound",
        column: "main",
        columns: 2,
        fields: [
          { field: "firstName", label: "Nombre", icon: "UserRound" },
          { field: "lastName", label: "Apellidos", icon: "UserRound" },
          { field: "phone", label: "Teléfono", icon: "Phone" },
          { field: "birthDate", label: "Fecha de nacimiento", type: "date", icon: "Calendar" },
          { field: "gender", label: "Sexo", icon: "VenusAndMars" },
        ],
      },
      {
        label: "Biografía",
        icon: "FileText",
        column: "main",
        fields: [{ field: "bio", label: "Biografía", type: "markdown", icon: "FileText" }],
      },
      {
        label: "Dirección",
        icon: "MapPin",
        column: "main",
        columns: 2,
        fields: [
          { field: "country", label: "País", icon: "MapPin" },
          { field: "state", label: "Estado / Provincia", icon: "MapPin" },
          { field: "city", label: "Ciudad / Municipio", icon: "MapPin" },
          { field: "colony", label: "Colonia", icon: "MapPin" },
          { field: "street", label: "Calle", icon: "MapPin" },
          { field: "extNumber", label: "Número exterior" },
          { field: "intNumber", label: "Número interior" },
          { field: "postalCode", label: "Código postal" },
        ],
      },
      {
        id: "memberships",
        type: "component",
        label: "Empresas y roles",
        icon: "Building2",
        column: "aside",
        component: "runly.identity:MembershipsSection",
      },
      {
        id: "permission-grants",
        type: "component",
        label: "Permisos",
        icon: "KeyRound",
        column: "main",
        component: "runly.identity:PermissionGrantsSection",
      },
      {
        id: "activity",
        type: "component",
        label: "Actividad",
        icon: "History",
        column: "aside",
        component: "runly.identity:UserActivitySection",
      },
      {
        id: "session-info",
        type: "component",
        label: "Sesión (Supabase)",
        icon: "LogIn",
        column: "aside",
        component: "runly.identity:UserSessionSection",
      },
    ],
  },
};

export default IDENTITY_USER_DETAIL;
