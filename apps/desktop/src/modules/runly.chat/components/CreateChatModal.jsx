import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  SearchInput,
} from "@runly/ui";
import { X, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { UserAvatar, UserPickerItem, UserListSkeleton } from "./UserPicker";

export function CreateChatModal({ open, onClose, onCreated }) {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);

  const { data: usersData, isLoading } = useQuery({
    queryKey: ["users-for-chat-picker"],
    queryFn: () => runly.identity.listCandidates(token, { pageSize: 100, action: 'chat' }),
    enabled: Boolean(token),
    staleTime: 120_000,
  });

  const users = (usersData?.data ?? []).filter(
    (u) =>
      u.id !== userProfile?.id &&
      (!search ||
        u.displayName?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())),
  );

  const isGroup = selected.length > 1;

  function toggleUser(u) {
    setSelected((prev) =>
      prev.some((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u],
    );
  }

  async function handleCreate() {
    if (!selected.length) return;
    setIsCreating(true);
    setError(null);
    try {
      const result = await runly.chat.createConversation(
        {
          type: isGroup ? "group" : "direct",
          title: isGroup && groupTitle.trim() ? groupTitle.trim() : undefined,
          memberUserIds: selected.map((u) => u.id),
        },
        token,
      );
      onCreated?.(result?.data ?? result);
      onClose?.();
      setSelected([]);
      setGroupTitle("");
      setSearch("");
    } catch (err) {
      setError(err?.message ?? "Error creando conversacion.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[hsl(var(--border))]">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[hsl(var(--primary))]" />
            Nueva conversacion
          </DialogTitle>
          <DialogDescription>
            Selecciona uno o varios usuarios para chatear.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-3 space-y-3">
          {/* Search input */}
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder="Buscar por nombre o correo..."
            autoFocus
          />

          {/* Group name field — only when multiple selected */}
          {isGroup && (
            <Input
              placeholder="Nombre del grupo (opcional)"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
            />
          )}

          {/* Selected chips */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1.5 text-xs pl-1 pr-2 py-0.5 rounded-full bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
                >
                  <UserAvatar user={u} size="sm" />
                  {u.displayName?.split(" ")[0]}
                  <button
                    type="button"
                    onClick={() => toggleUser(u)}
                    className="ml-0.5 hover:opacity-70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* User list */}
          <div className="max-h-56 overflow-y-auto space-y-0.5 -mx-2 px-2 py-1">
            {isLoading ? (
              <UserListSkeleton />
            ) : users.length ? (
              users.map((u) => (
                <UserPickerItem
                  key={u.id}
                  user={u}
                  selected={selected.some((s) => s.id === u.id)}
                  onToggle={toggleUser}
                />
              ))
            ) : (
              <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-6">
                No se encontraron usuarios.
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)]">
          <Button variant="outline" onClick={onClose} disabled={isCreating}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={!selected.length || isCreating}>
            {isCreating
              ? "Creando..."
              : isGroup
              ? `Crear grupo (${selected.length})`
              : "Iniciar chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
