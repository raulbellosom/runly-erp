import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Button,
  ConfirmDialog,
  SelectField,
  Input,
} from "@runly/ui";
import { Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import {
  useProjectFields,
  useCreateField,
  useUpdateField,
  useDeleteField,
} from "../hooks/useProjectsData";

const KIND_OPTIONS = [
  { value: "TEXT", label: "Texto" },
  { value: "NUMBER", label: "Numero" },
  { value: "DATE", label: "Fecha" },
  { value: "SELECT", label: "Seleccion" },
];

export default function ProjectFieldsSheet({ projectId, open, onOpenChange }) {
  const { data: fields = [], isLoading } = useProjectFields(projectId);
  const createField = useCreateField(projectId);
  const updateField = useUpdateField(projectId);
  const deleteField = useDeleteField(projectId);

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("TEXT");
  const [newOptions, setNewOptions] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editOptions, setEditOptions] = useState("");
  const [deleteId, setDeleteId] = useState(null);

  function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const options =
      newKind === "SELECT"
        ? newOptions
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    createField.mutate(
      { name, kind: newKind, options },
      {
        onSuccess: () => {
          setNewName("");
          setNewKind("TEXT");
          setNewOptions("");
          toast.success("Campo creado");
        },
        onError: () => toast.error("No se pudo crear el campo"),
      },
    );
  }

  function startEdit(field) {
    setEditingId(field.id);
    setEditName(field.name);
    setEditOptions((field.options ?? []).join(", "));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditOptions("");
  }

  function handleSaveEdit(field) {
    const name = editName.trim();
    if (!name) return;
    const options =
      field.kind === "SELECT"
        ? editOptions
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    updateField.mutate(
      { fieldId: field.id, name, options },
      {
        onSuccess: () => {
          cancelEdit();
          toast.success("Campo actualizado");
        },
        onError: () => toast.error("No se pudo actualizar el campo"),
      },
    );
  }

  function handleDelete() {
    deleteField.mutate(deleteId, {
      onSuccess: () => {
        setDeleteId(null);
        toast.success("Campo eliminado");
      },
      onError: () => toast.error("No se pudo eliminar el campo"),
    });
  }

  const fieldList = fields?.data ?? fields ?? [];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <SheetTitle>Campos personalizados</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {isLoading && (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            )}

            {fieldList.map((field) => (
              <div
                key={field.id}
                className="flex items-start gap-2 p-3 rounded-md border border-border bg-muted/30"
              >
                {editingId === field.id ? (
                  <div className="flex-1 space-y-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nombre del campo"
                      className="h-8 text-sm"
                      autoFocus
                    />
                    {field.kind === "SELECT" && (
                      <Input
                        value={editOptions}
                        onChange={(e) => setEditOptions(e.target.value)}
                        placeholder="Opciones separadas por coma"
                        className="h-8 text-sm"
                      />
                    )}
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => handleSaveEdit(field)}
                        disabled={!editName.trim() || updateField.isPending}
                      >
                        <Check size={12} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>
                        <X size={12} />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{field.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {KIND_OPTIONS.find((k) => k.value === field.kind)?.label ?? field.kind}
                        {field.kind === "SELECT" && field.options?.length > 0 && (
                          <span className="ml-1 text-muted-foreground/70">
                            ({field.options.join(", ")})
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => startEdit(field)}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteId(field.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}

            {fieldList.length === 0 && !isLoading && (
              <p className="text-sm text-muted-foreground">
                Sin campos personalizados. Agrega uno abajo.
              </p>
            )}

            <form
              onSubmit={handleCreate}
              className="space-y-3 pt-2 border-t border-border"
            >
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Nuevo campo
              </p>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre del campo"
                className="h-8 text-sm"
              />
              <SelectField
                label="Tipo"
                value={newKind}
                onValueChange={setNewKind}
                options={KIND_OPTIONS}
              />
              {newKind === "SELECT" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Opciones (separadas por coma)
                  </label>
                  <Input
                    value={newOptions}
                    onChange={(e) => setNewOptions(e.target.value)}
                    placeholder="Opcion 1, Opcion 2, ..."
                    className="h-8 text-sm"
                  />
                </div>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={!newName.trim() || createField.isPending}
              >
                <Plus size={13} className="mr-1" />
                Agregar campo
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Eliminar campo"
        description="Se eliminaran todos los valores de este campo en todas las tareas. Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
    </>
  );
}
