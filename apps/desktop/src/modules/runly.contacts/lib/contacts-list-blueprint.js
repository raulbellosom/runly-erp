import { TYPE_OPTIONS } from "../constants.js";

// Deep links (and the KPI tiles) open the list pre-filtered via these params.
export const CONTACTS_URL_FILTERS = ["type", "enabled", "tag", "createdFrom", "createdTo"];

const ENABLED_OPTIONS = [
  { value: "true", label: "Activo" },
  { value: "false", label: "Inactivo" },
];

export function buildContactsBlueprint({ tagOptions = [] } = {}) {
  return {
    key: "contacts.list",
    schema: {
      apiPath: "/contacts",
      primaryField: "name",
      // List/grid: email under the name, contact type as the badge, and the
      // photo as an avatar (initials when there is none) instead of a cover.
      subtitleField: "email",
      statusField: "type",
      cardMedia: "avatar",
      searchable: true,
      searchPlaceholder: "Buscar por nombre, RFC, correo, teléfono o persona...",
      columns: [
        {
          field: "avatarUrl",
          label: "Foto",
          type: "image",
          sortable: false,
          avatarLabelField: "name",
          avatarSignedUrlPath: "/contacts/:id/avatar/signed-url",
        },
        { field: "name", label: "Nombre", sortable: true, link: true },
        { field: "type", label: "Tipo", sortable: true, type: "select", options: TYPE_OPTIONS },
        { field: "primaryPersonName", label: "Contacto principal", sortable: false },
        { field: "email", label: "Correo", sortable: true },
        { field: "phone", label: "Teléfono", sortable: true },
        { field: "location", label: "Ubicación", sortable: false },
        { field: "taxId", label: "RFC / ID fiscal", sortable: true },
        { field: "tags", label: "Etiquetas", sortable: false },
        { field: "legalName", label: "Razón social", sortable: true, defaultVisible: false },
        { field: "industry", label: "Giro", sortable: true, defaultVisible: false },
        { field: "website", label: "Sitio web", sortable: true, defaultVisible: false },
        { field: "taxRegime", label: "Régimen fiscal", sortable: true, defaultVisible: false },
        { field: "fiscalPostalCode", label: "C.P. fiscal", sortable: false, defaultVisible: false },
        { field: "primaryPersonRole", label: "Puesto del contacto", sortable: false, defaultVisible: false },
        { field: "personsCount", label: "Personas", sortable: false, defaultVisible: false },
        { field: "addressesCount", label: "Direcciones", sortable: false, defaultVisible: false },
        {
          field: "enabled",
          label: "Estado",
          type: "select",
          sortable: false,
          defaultVisible: false,
          options: [
            { value: true, label: "Activo" },
            { value: false, label: "Inactivo" },
          ],
        },
        { field: "notesMarkdown", label: "Notas", type: "markdown", defaultVisible: false },
        { field: "createdAt", label: "Alta", type: "date", sortable: true, defaultVisible: false },
        { field: "updatedAt", label: "Actualizado", type: "date", sortable: true, defaultVisible: false },
      ],
      filters: [
        { key: "type", label: "Tipo", type: "select", options: TYPE_OPTIONS },
        { key: "enabled", label: "Estado", type: "select", options: ENABLED_OPTIONS },
        { key: "tag", label: "Etiqueta", type: "select", options: tagOptions },
        // -> createdFrom/createdTo on /contacts.
        { key: "created", label: "Fecha de alta", type: "daterange" },
      ],
      emptyState: { message: "No hay contactos registrados." },
    },
  };
}
