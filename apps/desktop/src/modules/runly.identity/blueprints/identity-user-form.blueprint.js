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
          {
            name: "username",
            label: "Nombre de usuario",
            type: "text",
            icon: "AtSign",
            hint: "Opcional. 3 a 30 caracteres: letras, números, punto, guion o guion bajo.",
          },
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
      {
        id: "attachments",
        type: "attachments",
        label: "Archivos",
        icon: "Paperclip",
        collapsible: true,
        attachments: {
          listPath: "/files?moduleKey=runly.identity&entityType=UserProfile&sourceEntityId=:id",
          upload: { endpoint: "/files/upload", moduleKey: "runly.identity", entityType: "UserProfile" },
          removePath: "/files/:docId",
          reorderPath: "/files/reorder",
          signedUrl: { endpointTemplate: "/files/:fileId/signed-url" },
          fields: { fileAssetId: "id", fileName: "originalName" },
          limits: { maxFiles: 20, maxSizeMB: 10, allowMultiple: true },
          permissions: {
            read: "identity.users.read",
            create: "identity.users.update",
            remove: "identity.users.update",
            fileUpload: "files.assets.create",
            fileRead: "files.assets.read",
          },
        },
      },
    ],
  },
};

export default IDENTITY_USER_FORM;
