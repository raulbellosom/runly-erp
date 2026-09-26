import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { runly } from "../lib/runly";
import { useAuth } from "../auth/AuthProvider";
import { toApiPath } from "../lib/apiPath.js";
import { pickTipText } from "../lib/help-tip.js";

// Shares the same queryKey as HelpButton's own resolveHelp query, so when
// both are mounted (footer always; the help sheet only while open) React
// Query dedupes the request instead of firing it twice per screen.
export function useHelpTip() {
  const { session } = useAuth();
  const token = session?.access_token;
  const location = useLocation();
  const apiPath = toApiPath(location.pathname);
  const { data } = useQuery({
    queryKey: ["help", "resolve", apiPath],
    queryFn: () => runly.help.resolveHelp(apiPath, token).then((r) => r.data),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  return pickTipText(data);
}
