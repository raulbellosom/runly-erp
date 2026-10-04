import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { runly } from "../lib/runly";
import { toggleHidden } from "../lib/homeWidgets";

const PREF_KEY = "home.widgets";

// Per-user Home widget visibility. Stores the hidden ids (not the visible ones)
// so widgets added later show up by default.
export function useHomeWidgetPrefs() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const debounceRef = useRef(null);
  const queryKey = ["user-preferences", PREF_KEY, token];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => runly.profile.getPreference(PREF_KEY, token),
    enabled: Boolean(token),
    staleTime: 300_000,
  });

  const mutation = useMutation({
    mutationFn: (value) => runly.profile.setPreference(PREF_KEY, value, token),
  });

  const hidden = Array.isArray(data?.value?.hidden) ? data.value.hidden : [];

  function toggle(id) {
    const next = { ...(data?.value ?? {}), hidden: toggleHidden(hidden, id) };
    queryClient.setQueryData(queryKey, { value: next });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => mutation.mutate(next), 500);
  }

  return { hidden, isLoading, toggle };
}
