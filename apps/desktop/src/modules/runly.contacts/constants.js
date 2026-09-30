export const TYPE_OPTIONS = [
  { value: "customer", label: "Cliente" },
  { value: "supplier", label: "Proveedor" },
  { value: "person", label: "Persona" },
  { value: "company", label: "Empresa" },
];

export const TYPE_VARIANT = {
  customer: "success",
  supplier: "glass",
  person: "secondary",
  company: "outline",
};

export const TYPE_LABEL = {
  customer: "Cliente",
  supplier: "Proveedor",
  person: "Persona",
  company: "Empresa",
};

// Hex per type for KPI dots and list/card initials tint.
export const TYPE_COLOR = {
  customer: "#10b981",
  supplier: "#3b82f6",
  person: "#8b5cf6",
  company: "#f59e0b",
};

// Avatar color per type (bg + text)
export const TYPE_AVATAR_COLORS = {
  customer: {
    bg: "bg-emerald-500/20 dark:bg-emerald-400/20 ring-1 ring-emerald-500/50 dark:ring-emerald-400/30",
    text: "text-emerald-900 dark:text-emerald-300",
  },
  supplier: {
    bg: "bg-blue-500/20    dark:bg-blue-400/20    ring-1 ring-blue-500/50    dark:ring-blue-400/30",
    text: "text-blue-900    dark:text-blue-300",
  },
  person: {
    bg: "bg-violet-500/20 dark:bg-violet-400/20 ring-1 ring-violet-500/50 dark:ring-violet-400/30",
    text: "text-violet-900 dark:text-violet-300",
  },
  company: {
    bg: "bg-amber-500/20  dark:bg-amber-400/20  ring-1 ring-amber-500/50  dark:ring-amber-400/30",
    text: "text-amber-900  dark:text-amber-300",
  },
};

export const CONTACTS_BLUEPRINT_FALLBACK = {
  key: "contacts.contact.entity",
  schema: {
    fields: [
      {
        name: "type",
        label: "Tipo de contacto",
        type: "select",
        required: true,
        options: TYPE_OPTIONS.map((o) => o.value),
      },
      { name: "name", label: "Nombre", type: "text", required: true },
      { name: "legalName", label: "Nombre legal", type: "text" },
      { name: "email", label: "Correo electronico", type: "email" },
      { name: "phone", label: "Telefono", type: "phone" },
      { name: "taxId", label: "RFC / Identificador fiscal", type: "text" },
      {
        name: "notesMarkdown",
        label: "Observaciones",
        type: "markdown",
        maxLength: 5000,
      },
    ],
  },
};
