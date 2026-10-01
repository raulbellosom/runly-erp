import { createStore } from 'zustand/vanilla'
import { create } from 'zustand'

const stateCreator = (set) => ({
  isOnline: true,
  pendingCount: 0,
  lastSyncAt: null,
  isSyncing: false,
  syncError: null,
  // Registered by OfflineProvider; null when no provider is mounted.
  reconnect: null,
  syncNow: null,
  setControls: ({ reconnect = null, syncNow = null } = {}) => set({ reconnect, syncNow }),
  setOnline: (isOnline) => set({ isOnline }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  incrementPending: () => set((s) => ({ pendingCount: s.pendingCount + 1 })),
  decrementPending: () => set((s) => ({ pendingCount: Math.max(0, s.pendingCount - 1) })),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setSyncError: (syncError) => set({ syncError }),
})

export function createOfflineStore() {
  return createStore(stateCreator)
}

export const useOfflineStore = create(stateCreator)
