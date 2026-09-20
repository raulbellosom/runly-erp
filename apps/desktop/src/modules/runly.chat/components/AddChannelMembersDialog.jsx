// apps/desktop/src/modules/runly.chat/components/AddChannelMembersDialog.jsx
//
// "Anadir miembros" picker for ChannelMembersTab — reuses the same
// user-search-and-multi-select pattern as CreateChatModal.jsx (shared
// sub-components live in ./UserPicker), but excludes every user who is
// already an active member of this conversation, not just the current user.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  SearchInput,
} from "@runly/ui";
import { X, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useAddMembers } from "../hooks/useCreateConversation";
import { UserAvatar, UserPickerItem, UserListSkeleton } from "./UserPicker";
import { ResourceInvitationControl } from '../../../company/ResourceInvitationControl.jsx';

export function AddChannelMembersDialog({ open, onClose, conversationId, existingMemberIds = [] }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState(null);
  const { mutateAsync: addMembers, isPending: isAdding } = useAddMembers(conversationId);

  const { data: usersData, isLoading } = useQuery({
    queryKey: ["users-for-chat-picker"],
    queryFn: () => runly.identity.listCandidates(token, { pageSize: 100, action: 'chat' }),
    enabled: Boolean(token) && open,
    staleTime: 120_000,
  });

  const existingIds = new Set(existingMemberIds);
  const users = (usersData?.data ?? []).filter(
    (u) =>
      !existingIds.has(u.id) &&
      (!search ||
        u.displayName?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())),
  );

  function toggleUser(u) {
    setSelected((prev) =>
      prev.some((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u],
    );
  }

  function resetAndClose() {
    setSelected([]);
    setSearch("");
    setError(null);
    onClose?.();
  }

  async function handleAdd() {
    if (!selected.length) return;
    setError(null);
    try {
      await addMembers({ userIds: selected.map((u) => u.id) });
      resetAndClose();
    } catch (err) {
      const msg = err?.message ?? "No se pudieron agregar los miembros.";
      setError(msg);
      // The inline line can be scrolled out of view in a tall list — surface it.
      toast.error(msg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && resetAndClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[hsl(var(--border))]">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[hsl(var(--primary))]" />
            Anadir miembros
          </DialogTitle>
          <DialogDescription>
            Selecciona uno o varios usuarios para anadir a este canal.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-3 space-y-3">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder="Buscar por nombre o correo..."
            autoFocus
          />

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

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <ResourceInvitationControl resourceType="chat" resourceId={conversationId} />
        <DialogFooter className="px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)]">
          <Button variant="outline" onClick={resetAndClose} disabled={isAdding}>
            Cancelar
          </Button>
          <Button onClick={handleAdd} disabled={!selected.length || isAdding}>
            {isAdding ? "Anadiendo..." : `Anadir (${selected.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
