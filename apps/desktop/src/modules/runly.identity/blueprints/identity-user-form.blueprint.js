export const IDENTITY_USER_FORM = {
  key: "identity.user.form",
  kind: "FORM",
  schema: {
    entity: "identityUser",
    component: "RunlyForm",
    apiPath: "/identity/users",
    sections: [
      {
        id: "identity",
        title: "Identidad",
        icon: "UserRound",
        columns: 2,
        fields: [
          { name: "firstName", label: "Nombre", type: "text", required: true, icon: "UserRound" },
          { name: "lastName", label: "Apellidos", type: "text", required: true, icon: "UserRound" },
          { name: "email", label: "Correo electrónico", type: "text", required: true, icon: "Mail" },
          { name: "phone", label: "Teléfono", type: "phone", icon: "Phone" },
          { name: "birthDate", label: "Fecha de nacimiento", type: "date", icon: "Calendar" },
          {
            name: "gender",
            label: "Sexo",
            type: "select",
            icon: "VenusAndMars",
            options: [
              { value: "male", label: "Masculino" },
              { value: "female", label: "Femenino" },
              { value: "other", label: "Otro" },
            ],
          },
          { name: "enabled", label: "Activo", type: "checkbox", icon: "CircleCheck" },
        ],
      },
      {
        id: "profile",
        title: "Perfil",
        icon: "FileText",
        fields: [{ name: "bio", label: "Biografía", type: "markdown", icon: "FileText" }],
      },
      {
        id: "address",
        type: "component",
        title: "Dirección",
        icon: "MapPin",
        component: "runly.identity:AddressFieldsSection",
        fields: ["country", "state", "city", "colony", "street", "extNumber", "intNumber", "postalCode"],
      },
    ],
  },
};

export default IDENTITY_USER_FORM;
