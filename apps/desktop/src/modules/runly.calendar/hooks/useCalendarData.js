import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { useOfflineContext, useOfflineStore } from "@runly/offline";
import { runly } from "../../../lib/runly";

function useToken() {
  const { session } = useAuth();
  return session?.access_token;
}

// ── Calendars ─────────────────────────────────────────────────────────────────

export function useCalendars() {
  const token = useToken();
  const ctx = useOfflineContext();
  const isOnline = useOfflineStore((s) => s.isOnline);
  return useQuery({
    queryKey: ["calendar", "calendars"],
    queryFn: async () => {
      if (!isOnline) {
        const db = ctx?.dbRef?.current;
        if (!db) return { owned: [], shared: [] };
        const records = await db.offline_records
          .where("moduleKey")
          .equals("runly.calendar")
          .filter((r) => r.entityType === "calendar")
          .toArray();
        // Shared calendars are not cached in Tier 2; only owned calendars are pulled
        return { owned: records.map((r) => r.data), shared: [] };
      }
      return runly.calendar.listCalendars(token);
    },
    enabled: Boolean(token),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateCalendar() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => runly.calendar.createCalendar(data, token),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calendar", "calendars"] }),
  });
}

export function useUpdateCalendar() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) =>
      runly.calendar.updateCalendar(id, data, token),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calendar", "calendars"] }),
  });
}

export function useDeleteCalendar() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => runly.calendar.deleteCalendar(id, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar", "calendars"] });
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
    },
  });
}

export function useShareCalendar() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ calendarId, ...data }) =>
      runly.calendar.shareCalendar(calendarId, data, token),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calendar", "calendars"] }),
  });
}

export function useUpdateShare() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ calendarId, shareId, ...data }) =>
      runly.calendar.updateShare(calendarId, shareId, data, token),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calendar", "calendars"] }),
  });
}

export function useDeleteShare() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ calendarId, shareId }) =>
      runly.calendar.deleteShare(calendarId, shareId, token),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calendar", "calendars"] }),
  });
}

// ── Events ────────────────────────────────────────────────────────────────────

export function useCalendarEvents({ start, end, calendarIds = [] }) {
  const token = useToken();
  const ctx = useOfflineContext();
  const isOnline = useOfflineStore((s) => s.isOnline);
  return useQuery({
    queryKey: ["calendar", "events", start, end, calendarIds.join(",")],
    queryFn: async () => {
      if (!isOnline) {
        const db = ctx?.dbRef?.current;
        if (!db) return [];
        const startMs = start ? new Date(start).getTime() : null;
        const endMs = end ? new Date(end).getTime() : null;
        const records = await db.offline_records
          .where("moduleKey")
          .equals("runly.calendar")
          .filter((r) => r.entityType === "event")
          .toArray();
        return records
          .map((r) => r.data)
          .filter((ev) => {
            if (calendarIds.length && !calendarIds.includes(ev.calendarId))
              return false;
            const evMs = new Date(ev.startAt).getTime();
            if (startMs !== null && evMs < startMs) return false;
            if (endMs !== null && evMs > endMs) return false;
            return true;
          });
      }
      return runly.calendar.listEvents(token, {
        start,
        end,
        calendar_ids: calendarIds,
      });
    },
    enabled: Boolean(token && start && end),
    staleTime: 60 * 1000,
  });
}

// Year-level events — stable query key prevents cache misses when navigating months
export function useYearEvents(year, calendarIds = [], enabled = true) {
  const token = useToken();
  const ctx = useOfflineContext();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);
  return useQuery({
    queryKey: ["calendar", "events", "year", year, calendarIds.join(",")],
    queryFn: async () => {
      if (!isOnline) {
        const db = ctx?.dbRef?.current;
        if (!db) return [];
        const startMs = yearStart.getTime();
        const endMs = yearEnd.getTime();
        const records = await db.offline_records
          .where("moduleKey")
          .equals("runly.calendar")
          .filter((r) => r.entityType === "event")
          .toArray();
        return records
          .map((r) => r.data)
          .filter((ev) => {
            if (calendarIds.length && !calendarIds.includes(ev.calendarId))
              return false;
            const evMs = new Date(ev.startAt).getTime();
            return evMs >= startMs && evMs <= endMs;
          });
      }
      return runly.calendar.listEvents(token, {
        start: yearStart.toISOString(),
        end: yearEnd.toISOString(),
        calendar_ids: calendarIds,
      });
    },
    enabled: Boolean(token && enabled),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// User search for the calendar share combobox
export function useUserSearch(query) {
  const token = useToken();
  const q = query.trim();
  return useQuery({
    queryKey: ["identity", "users", "search", q],
    queryFn: () =>
      runly.identity.listCandidates(token, { action: 'calendar',
        search: q,
        pageSize: 10,
        enabled: true,
      }),
    enabled: Boolean(token && q.length >= 2),
    staleTime: 30 * 1000,
  });
}

export function useCreateEvent() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => runly.calendar.createEvent(data, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar", "events"] }),
  });
}

export function useCalendarEvent(eventId, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: ["calendar", "event", eventId],
    queryFn: () => runly.calendar.getEvent(eventId, token),
    enabled: Boolean(token && eventId && enabled),
    staleTime: 30 * 1000,
  });
}

export function useUpdateEvent() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) =>
      runly.calendar.updateEvent(id, data, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar", "events"] }),
  });
}

export function useDeleteEvent() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => runly.calendar.deleteEvent(id, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar", "events"] }),
  });
}

export function useAddEventReminder() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, minutesBefore }) =>
      runly.calendar.createReminder(
        eventId,
        { minutes_before: minutesBefore },
        token,
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
      qc.invalidateQueries({ queryKey: ["calendar", "event", vars?.eventId] });
    },
  });
}

export function useDeleteEventReminder() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, reminderId }) =>
      runly.calendar.deleteReminder(eventId, reminderId, token),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
      qc.invalidateQueries({ queryKey: ["calendar", "event", vars?.eventId] });
    },
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────

export function useCalendarNotifications() {
  const token = useToken();
  return useQuery({
    queryKey: ["calendar", "notifications"],
    queryFn: () =>
      runly.calendar.listNotifications(token, { unread_only: true }),
    enabled: Boolean(token),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 30 * 1000,
  });
}

export function useMarkNotificationRead() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => runly.calendar.markNotificationRead(id, token),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calendar", "notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runly.calendar.markAllNotificationsRead(token),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calendar", "notifications"] }),
  });
}
