import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { runly } from "../../../lib/runly";

function useDebounced(value, delay = 500) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Non-blocking duplicate lookup on RFC, primary email and primary phone.
export function useDuplicateCheck({ values, excludeId, token }) {
  const channels = values.channels ?? [];
  const pick = (kind) =>
    (channels.find((c) => c.kind === kind && c.isPrimary && c.value) ?? channels.find((c) => c.kind === kind && c.value))?.value ?? "";
  const criteria = useDebounced({
    taxId: String(values.taxId ?? "").trim(),
    email: pick("email").trim(),
    phone: pick("phone").trim(),
  });
  const hasCriteria = criteria.taxId.length >= 12 || criteria.email.includes("@") || criteria.phone.replace(/\D/g, "").length >= 8;

  const query = useQuery({
    queryKey: ["contact-duplicates", criteria, excludeId],
    queryFn: () => runly.contacts.findDuplicates({ ...criteria, excludeId: excludeId ?? undefined }, token),
    enabled: Boolean(token && hasCriteria),
    staleTime: 30_000,
  });
  return hasCriteria ? query.data?.data ?? [] : [];
}
