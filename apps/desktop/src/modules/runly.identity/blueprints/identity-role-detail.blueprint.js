export const IDENTITY_ROLE_DETAIL = {
  key: "identity.role.detail",
  kind: "DETAIL",
  schema: {
    entity: "identityRole",
    component: "RunlyDetail",
    apiPath: "/identity/roles",
    layout: "two-column",
    hero: {
      titleField: "name",
      subtitleFields: ["key"],
      statusField: "enabled",
      statusMap: { true: "Activo", false: "Inactivo" },
      fallbackIcon: "Shield",
      metaChips: [
        { field: "system", label: "Sistema", type: "select", options: [{ value: true, label: "Sí" }, { value: false, label: "No" }] },
      ],
    },
    kpis: [
      { label: "Permisos asignados", field: "permissionKeys.length", icon: "KeyRound" },
      { label: "Usuarios con este rol", field: "memberCount", icon: "Users" },
    ],
    sections: [
      {
        id: "permission-tree",
        type: "component",
        label: "Permisos",
        icon: "KeyRound",
        column: "main",
        component: "runly.identity:PermissionTreeSection",
      },
      {
        id: "role-members",
        type: "component",
        label: "Usuarios con este rol",
        icon: "Users",
        column: "aside",
        component: "runly.identity:RoleMembersSection",
      },
    ],
  },
};

export default IDENTITY_ROLE_DETAIL;
