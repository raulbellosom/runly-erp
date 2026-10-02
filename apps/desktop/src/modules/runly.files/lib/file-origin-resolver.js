const MODULE_LABELS = {
  "runly.core": "Runly Core",
  "runly.identity": "Identidad",
  "runly.files": "Archivos",
  "runly.company": "Empresa",
  "runly.contacts": "Contactos",
  "runly.hr": "Recursos Humanos",
  "runly.canvas": "Canvas",
  "runly.projects": "Proyectos",
  "runly.inventory": "Inventario",
  "runly.purchases": "Compras",
  "runly.pfm": "Finanzas personales",
};

function getModuleLabel(moduleKey) {
  return MODULE_LABELS[moduleKey] ?? moduleKey ?? "Modulo desconocido";
}

export function resolveFileOrigin(file) {
  const detailPath = `/app/m/runly.files/files/${file?.id ?? ""}`;
  const moduleKey = file?.moduleKey ?? "runly.files";
  const sourceEntityId = file?.metadata?.sourceEntityId ?? null;

  if (moduleKey === "runly.company") {
    return {
      label: "Logo de empresa",
      moduleLabel: getModuleLabel(moduleKey),
      detailPath,
      originPath: "/app/m/runly.company/company/branding",
      originHint: "Logotipo y colores de marca",
    };
  }

  if (moduleKey === "runly.contacts") {
    return {
      label: "Modulo de contactos",
      moduleLabel: getModuleLabel(moduleKey),
      detailPath,
      originPath: "/app/m/runly.contacts/contacts",
      originHint: sourceEntityId
        ? `Relacionado con contacto ${sourceEntityId}`
        : "Relacionado con contactos",
    };
  }

  if (moduleKey === "runly.files") {
    return {
      label: "Modulo de archivos",
      moduleLabel: getModuleLabel(moduleKey),
      detailPath,
      originPath: "/app/m/runly.files/files",
      originHint: "Archivo cargado desde el explorador",
    };
  }

  if (moduleKey === "runly.hr") {
    return {
      label: "Modulo de RH",
      moduleLabel: getModuleLabel(moduleKey),
      detailPath,
      originPath: sourceEntityId
        ? `/app/m/runly.hr/hr/employees/${sourceEntityId}`
        : "/app/m/runly.hr/hr/employees",
      originHint: sourceEntityId
        ? `Relacionado con colaborador ${sourceEntityId}`
        : "Relacionado con colaboradores",
    };
  }

  if (moduleKey === "runly.canvas") {
    const board = file?.entityType === "CanvasBoard" && sourceEntityId;
    return {
      label: board ? "Plano de Canvas" : "Punto de interés de Canvas",
      moduleLabel: getModuleLabel(moduleKey),
      detailPath,
      originPath: board ? `/app/m/runly.canvas/${sourceEntityId}` : "/app/m/runly.canvas",
      originHint: "Visible para los miembros del plano",
    };
  }

  return {
    label: getModuleLabel(moduleKey),
    moduleLabel: getModuleLabel(moduleKey),
    detailPath,
    originPath: null,
    originHint: "Origen no navegable en esta version",
  };
}
