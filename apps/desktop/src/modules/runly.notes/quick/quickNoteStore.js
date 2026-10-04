import { create } from "zustand";
import { persist } from "zustand/middleware";

// Floating quick-notes UI state, per device (position and open state are a
// local convenience; the notes themselves live in runly.notes).
export const useQuickNoteStore = create(
  persist(
    (set) => ({
      isOpen: false,
      minimized: false,
      expanded: false,
      panelPos: null, // { x, y } top-left; null = default spot
      bubblePos: null,
      mobileY: null, // phones: panel is full width, only its top is draggable
      noteId: null,

      open: () => set({ isOpen: true, minimized: false }),
      close: () => set({ isOpen: false, minimized: false }),
      minimize: () => set({ minimized: true }),
      restore: () => set({ minimized: false }),
      toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
      // Shortcut: closed -> open; minimized -> restore; open -> minimize.
      toggleFromShortcut: () =>
        set((s) => {
          if (!s.isOpen) return { isOpen: true, minimized: false };
          return { minimized: !s.minimized };
        }),
      setPanelPos: (panelPos) => set({ panelPos }),
      setBubblePos: (bubblePos) => set({ bubblePos }),
      setMobileY: (mobileY) => set({ mobileY }),
      setNoteId: (noteId) => set({ noteId }),
    }),
    {
      name: "runly.quickNotes",
      partialize: ({ isOpen, minimized, expanded, panelPos, bubblePos, mobileY, noteId }) => ({
        isOpen,
        minimized,
        expanded,
        panelPos,
        bubblePos,
        mobileY,
        noteId,
      }),
    },
  ),
);
