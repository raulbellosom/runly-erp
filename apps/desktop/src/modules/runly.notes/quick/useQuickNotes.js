import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useQuickNoteStore } from "./quickNoteStore";

export const QUICK_NOTES_FOLDER = "Notas rápidas";
const LIST_SIZE = 12;

// Quick notes live in a regular runly.notes folder ("Notas rápidas"), so they
// show up, sync and can be organized in the Notes module like any other note.
export function useQuickNotes({ enabled }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const noteId = useQuickNoteStore((s) => s.noteId);
  const setNoteId = useQuickNoteStore((s) => s.setNoteId);
  const [creating, setCreating] = useState(false);
  const autoCreatedRef = useRef(false);
  const active = Boolean(enabled && token);

  const foldersQuery = useQuery({
    queryKey: ["notes", "quick", "folders", token],
    queryFn: () => runly.notes.listFolders(token),
    enabled: active,
    staleTime: 300_000,
  });
  const folder =
    (foldersQuery.data?.folders ?? []).find(
      (f) => f.name === QUICK_NOTES_FOLDER && !f.parent_folder_id,
    ) ?? null;

  const listQuery = useQuery({
    queryKey: ["notes", "quick", "list", folder?.id, token],
    queryFn: () => runly.notes.list({ folderId: folder.id, trashed: false, pageSize: LIST_SIZE }, token),
    enabled: active && Boolean(folder?.id),
    staleTime: 30_000,
  });
  const notes = listQuery.data?.notes ?? [];

  const noteQuery = useQuery({
    queryKey: ["notes", noteId],
    queryFn: () => runly.notes.get(noteId, token),
    enabled: active && Boolean(noteId),
    select: (res) => res?.note ?? res,
    retry: false,
  });

  // A stored id from another company, or a trashed note: forget it.
  useEffect(() => {
    if (noteQuery.isError) setNoteId(null);
  }, [noteQuery.isError, setNoteId]);

  const createNote = useCallback(async () => {
    if (!token || creating) return;
    setCreating(true);
    try {
      let folderId = folder?.id;
      if (!folderId) {
        const res = await runly.notes.createFolder({ name: QUICK_NOTES_FOLDER, icon: "Zap" }, token);
        folderId = res?.folder?.id;
        queryClient.invalidateQueries({ queryKey: ["notes", "quick", "folders"] });
      }
      const res = await runly.notes.create({ title: "", content: "", folderId }, token);
      const created = res?.note;
      if (created?.id) {
        queryClient.setQueryData(["notes", created.id], { note: created });
        setNoteId(created.id);
      }
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    } finally {
      setCreating(false);
    }
  }, [token, creating, folder?.id, queryClient, setNoteId]);

  // First open: fall back to the newest quick note, or create one so the user
  // can type immediately.
  const listSettled = foldersQuery.isSuccess && (!folder || listQuery.isSuccess);
  useEffect(() => {
    if (!active || noteId || !listSettled) return;
    if (notes.length > 0) {
      setNoteId(notes[0].id);
    } else if (!autoCreatedRef.current) {
      autoCreatedRef.current = true;
      createNote();
    }
  }, [active, noteId, listSettled, notes, setNoteId, createNote]);

  return {
    folder,
    notes,
    note: noteId ? noteQuery.data ?? null : null,
    isLoading: foldersQuery.isLoading || listQuery.isLoading || noteQuery.isLoading || creating,
    isError: foldersQuery.isError,
    createNote,
    selectNote: setNoteId,
    creating,
  };
}
