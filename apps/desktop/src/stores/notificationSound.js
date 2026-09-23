import { create } from "zustand";
import { persist } from "zustand/middleware";

// Mutes only the in-app "new notification" chime (see callSounds.js's
// "notification" sound). Call ringtone/join/exit sounds are unaffected —
// this is strictly the passive alert sound, not a do-not-disturb switch.
export const useNotificationSoundStore = create(
  persist(
    (set, get) => ({
      muted: false,
      toggle() {
        set({ muted: !get().muted });
      },
    }),
    { name: "runly-notification-sound" },
  ),
);
