// Module Builder — Datos tab (Etapas 7-8): list of collapsible entity cards.
// Field editing lives in EntityCard / EntityFieldList / FieldSheet.
import { useState } from "react";
import {
  Button,
  TextField,
  ConfirmDialog,
  EmptyState,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@runly/ui";
import { ChevronsDownUp, ChevronsUpDown, Database, Plus } from "lucide-react";
import { addEntity, removeEntity } from "../../lib/builderHelpers";
import { EntityCard } from "./EntityCard";

export function EntitiesTab({ definition, onChange, publishedDefinition, readOnly }) {
  const entities = definition.entities ?? [];
  const [addingEntity, setAddingEntity] = useState(false);
  const [newEntityLabel, setNewEntityLabel] = useState("");
  const [confirmDeleteEntity, setConfirmDeleteEntity] = useState(null);
  // Start with everything open only while the list is short; larger modules
  // open collapsed so the tab stays scannable.
  const [expandedKeys, setExpandedKeys] = useState(() => new Set(entities.length <= 2 ? entities.map((e) => e.key) : []));
  const allExpanded = entities.length > 0 && entities.every((e) => expandedKeys.has(e.key));

  function toggle(key) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleCreateEntity() {
    const next = addEntity(definition, { label: newEntityLabel.trim() });
    const created = next.entities[next.entities.length - 1];
    onChange(next);
    setExpandedKeys((current) => new Set(current).add(created.key));
    setNewEntityLabel("");
    setAddingEntity(false);
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Entidades</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Cada entidad es una tabla con sus campos, vistas y permisos.</p>
        </div>
        <div className="flex items-center gap-2">
          {entities.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpandedKeys(allExpanded ? new Set() : new Set(entities.map((e) => e.key)))}
            >
              {allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
              {allExpanded ? "Contraer todo" : "Expandir todo"}
            </Button>
          )}
          {!readOnly && (
            <Button size="sm" onClick={() => setAddingEntity(true)}>
              <Plus className="h-4 w-4" />
              Añadir entidad
            </Button>
          )}
        </div>
      </div>

      {!entities.length && (
        <EmptyState
          icon={Database}
          title="Sin entidades"
          description="Crea la primera entidad para empezar a definir los datos del módulo."
          action={!readOnly ? { label: "Añadir entidad", onClick: () => setAddingEntity(true) } : undefined}
        />
      )}

      {entities.map((entity) => (
        <EntityCard
          key={entity.key}
          entity={entity}
          definition={definition}
          onChange={onChange}
          publishedDefinition={publishedDefinition}
          readOnly={readOnly}
          expanded={expandedKeys.has(entity.key)}
          onToggle={() => toggle(entity.key)}
          onDelete={() => setConfirmDeleteEntity(entity)}
        />
      ))}

      <Dialog open={addingEntity} onOpenChange={setAddingEntity}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva entidad</DialogTitle></DialogHeader>
          <TextField
            label="Nombre"
            icon={Database}
            value={newEntityLabel}
            onChange={(e) => setNewEntityLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newEntityLabel.trim()) handleCreateEntity(); }}
            placeholder="Vehículo"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingEntity(false)}>Cancelar</Button>
            <Button disabled={!newEntityLabel.trim()} onClick={handleCreateEntity}>Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDeleteEntity)}
        onOpenChange={(open) => !open && setConfirmDeleteEntity(null)}
        title="Eliminar entidad"
        description={`Se eliminará "${confirmDeleteEntity?.label}" y sus vistas asociadas del borrador.`}
        confirmLabel="Eliminar"
        onConfirm={() => {
          onChange((d) => removeEntity(d, confirmDeleteEntity.key));
          setConfirmDeleteEntity(null);
        }}
      />
    </div>
  );
}
