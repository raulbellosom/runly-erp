// Module Builder — Permisos tab (Etapa 11). CRUD permissions are generated
// automatically per entity by normalizeModuleDefinition(); this MVP shows
// them read-only. Assigning permissions to roles remains the existing
// Runly administration flow (Identidad > Roles), not duplicated here.
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge } from "@runly/ui";
import { Check } from "lucide-react";

export function PermissionsTab({ definition }) {
  return (
    <div className="pt-4 max-w-2xl space-y-3">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Cada entidad genera automáticamente permisos de lectura, creación, edición y baja. Asigna estos permisos a roles desde Identidad &gt; Roles una vez publicado el módulo.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entidad</TableHead>
            <TableHead className="text-center">Leer</TableHead>
            <TableHead className="text-center">Crear</TableHead>
            <TableHead className="text-center">Editar</TableHead>
            <TableHead className="text-center">Eliminar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {definition.entities.map((entity) => (
            <TableRow key={entity.key}>
              <TableCell>
                <div className="font-medium">{entity.label}</div>
                <div className="text-xs font-mono text-[hsl(var(--muted-foreground))]">{entity.key}</div>
              </TableCell>
              {["read", "create", "update", "delete"].map((action) => (
                <TableCell key={action} className="text-center">
                  <Check className="h-4 w-4 mx-auto text-green-600" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!definition.entities.length && <Badge variant="outline">Añade entidades en la pestaña Datos para generar permisos.</Badge>}
    </div>
  );
}
