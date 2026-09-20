import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider.jsx";
import { runly } from "../../../lib/runly";
import { subscribeToMultiBroadcast } from "../lib/supabaseRealtime";

export function useExternalInbox(status = "open", search = null) {
  const { session } = useAuth();
  const { activeCompanyId: companyId } = useActiveCompany();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const unsubRefs = useRef([]);

  const query = useQuery({
    queryKey: ["chat-external-inbox", companyId, status, search],
    queryFn: () => runly.chat.listExternalInbox({ status, ...(search ? { search } : {}) }, token),
    enabled: Boolean(token && companyId),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chat-external-inbox"], exact: false });
  }, [queryClient]);

  useEffect(() => {
    if (!companyId) return;

    const unsub = subscribeToMultiBroadcast(`chat:company:${companyId}`, {
      new_external_conversation: invalidate,
      external_message: invalidate,
    });

    unsubRefs.current = [unsub];
    return () => {
      unsubRefs.current.forEach((fn) => fn?.());
      unsubRefs.current = [];
    };
  }, [companyId, invalidate]);

  return query;
}
