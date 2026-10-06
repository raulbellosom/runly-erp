import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { findFirstUrl } from "@runly/ui";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

// WhatsApp-style preview of the first link in a message body, rendered inside
// the text bubble right under the text. Renders nothing while loading or when
// the page has no usable Open Graph metadata, so plain links never show an
// empty frame.
export function LinkPreviewCard({ body, isOwn }) {
  const { session } = useAuth();
  const url = findFirstUrl(body);
  const [imageFailed, setImageFailed] = useState(false);
  const { data: preview } = useQuery({
    queryKey: ["chat-link-preview", url],
    queryFn: async () => (await runly.chat.linkPreview(url, session?.access_token))?.data ?? null,
    enabled: Boolean(url && session?.access_token),
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  if (!url || !preview) return null;

  const showImage = preview.image && !imageFailed;
  return (
    <a
      href={preview.url || url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={[
        "mt-1.5 block w-[min(20rem,70vw)] max-w-full overflow-hidden rounded-lg border-l-4 no-underline transition-opacity hover:opacity-90",
        isOwn ? "border-white/60 bg-black/15" : "border-(--brand-primary) bg-black/5 dark:bg-white/5",
      ].join(" ")}
    >
      {showImage && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="block max-h-44 w-full object-cover"
        />
      )}
      <div className="min-w-0 px-2.5 py-2">
        <p className="truncate text-[11px] uppercase tracking-wide opacity-70">{preview.siteName}</p>
        {preview.title && <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{preview.title}</p>}
        {preview.description && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug opacity-80">{preview.description}</p>
        )}
      </div>
    </a>
  );
}
