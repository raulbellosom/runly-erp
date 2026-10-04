import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useQuickNoteStore } from "./quickNoteStore";

const LIST_SIZE = 30;

// Canvas notes need the whiteboard surface; the floating pad only edits
// document notes.
export function isDocumentNote(note) {
  return (note?.note_type ?? note?.noteType ?? "document") !== "canvas";
}

// The floating pad works on the user's regular notes (same list as the Notes
// module, most recent first) and creates new ones there.
export function useQuickNotes({ enabled }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const noteId = useQuickNoteStore((s) => s.noteId);
  const setNoteId = useQuickNoteStore((s) => s.setNoteId);
  const [creating, setCreating] = useState(false);
  const autoCreatedRef = useRef(false);
  const active = Boolean(enabled && token);

  const listQuery = useQuery({
    queryKey: ["notes", "quick", "recent", token],
    queryFn: () => runly.notes.list({ trashed: false, archived: false, pageSize: LIST_SIZE }, token),
    enabled: active,
    staleTime: 30_000,
  });
  const notes = (listQuery.data?.notes ?? []).filter(isDocumentNote);

  // Same key and raw shape as the Notes module's useNote, so both share cache.
  const noteQuery = useQuery({
    queryKey: ["notes", noteId],
    queryFn: () => runly.notes.get(noteId, token),
    enabled: active && Boolean(noteId),
    retry: false,
  });
  const note = noteQuery.data?.note ?? null;

  // A stored id from another company, a trashed note or a canvas: forget it.
  useEffect(() => {
    if (noteQuery.isError || (note && !isDocumentNote(note))) setNoteId(null);
  }, [noteQuery.isError, note, setNoteId]);

  const createNote = useCallback(async () => {
    if (!token || creating) return;
    setCreating(true);
    try {
      const res = await runly.notes.create({ title: "", content: "" }, token);
      const created = res?.note;
      if (created?.id) {
        queryClient.setQueryData(["notes", created.id], { note: created });
        setNoteId(created.id);
      }
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    } finally {
      setCreating(false);
    }
  }, [token, creating, queryClient, setNoteId]);

  // First open: continue with the most recent note, or create one when the
  // user has none yet, so typing can start immediately.
  useEffect(() => {
    if (!active || noteId || !listQuery.isSuccess) return;
    if (notes.length > 0) {
      setNoteId(notes[0].id);
    } else if (!autoCreatedRef.current) {
      autoCreatedRef.current = true;
      createNote();
    }
  }, [active, noteId, listQuery.isSuccess, notes, setNoteId, createNote]);

  return {
    notes,
    note: noteId && note && isDocumentNote(note) ? note : null,
    isLoading: listQuery.isLoading || noteQuery.isLoading || creating,
    isError: listQuery.isError,
    createNote,
    selectNote: setNoteId,
    creating,
  };
}
