import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useChatFloatStore = create(
  persist(
    (set, get) => ({
      edge: "right",
      yPx: null, // null = 75% of viewport height
      isOpen: false,
      hidden: false, // user explicitly hid the bubble
      openChats: [], // [{ id, conversation, minimized }]

      setPosition: (edge, yPx) => set({ edge, yPx }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      close: () => set({ isOpen: false }),
      hide: () => set({ hidden: true, isOpen: false }),
      show: () => set({ hidden: false }),

      openChat: (conversation) => {
        const chats = get().openChats;
        if (chats.some((c) => c.id === conversation.id)) {
          set({
            isOpen: false,
            openChats: chats.map((c) =>
              c.id === conversation.id ? { ...c, minimized: false } : c,
            ),
          });
          return;
        }
        const next =
          chats.length >= 3
            ? [...chats.slice(1), { id: conversation.id, conversation, minimized: false }]
            : [...chats, { id: conversation.id, conversation, minimized: false }];
        set({ openChats: next, isOpen: false });
      },

      closeChat: (id) =>
        set((s) => ({ openChats: s.openChats.filter((c) => c.id !== id) })),

      toggleMinimize: (id) =>
        set((s) => ({
          openChats: s.openChats.map((c) =>
            c.id === id ? { ...c, minimized: !c.minimized } : c,
          ),
        })),
    }),
    {
      name: "runly-chat-float",
      version: 1,
      migrate: (state) => ({ edge: state.edge, yPx: state.yPx, hidden: state.hidden }),
      partialize: (s) => ({ edge: s.edge, yPx: s.yPx, hidden: s.hidden }),
    },
  ),
);
