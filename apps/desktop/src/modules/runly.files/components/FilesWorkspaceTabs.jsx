import { Button } from "@runly/ui";

const TABS = [
  ["mine", "Mis archivos"],
  ["shared", "Compartidos conmigo"],
  ["modules", "De mis módulos"],
  ["invitations", "Invitaciones"],
];

export const FILES_WORKSPACES = [...TABS.map(([key]) => key), "all"];

// "Todos" lists every company file and is only offered to administrators.
export function FilesWorkspaceTabs({ workspace, isCompanyAdmin, onChange }) {
  const tabs = isCompanyAdmin ? [...TABS, ["all", "Todos"]] : TABS;
  return (
    <nav className="files-workspace-tabs" aria-label="Vistas de archivos">
      {tabs.map(([key, label]) => (
        <Button
          key={key}
          variant={workspace === key ? "secondary" : "ghost"}
          aria-current={workspace === key ? "page" : undefined}
          onClick={() => onChange(key)}
        >
          {label}
        </Button>
      ))}
    </nav>
  );
}
