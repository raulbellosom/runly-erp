import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdvancedFileViewer, Avatar, AvatarFallback, AvatarImage } from "@runly/ui";
import { ZoomIn } from "lucide-react";
import { runly } from "../../../lib/runly";

const SIGNED_URL_STALE_MS = 50 * 60 * 1000;

// Progressive user avatar: paints the embedded 40px `thumb` URL immediately,
// swaps to the 96px `card` variant once it has loaded, preloads the `full`
// variant in the background, and opens it in AdvancedFileViewer on click.
export function UserAvatarPreview({ userId, avatarUrl, displayName, token, isUploading = false }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const hasAvatar = Boolean(avatarUrl);

  const resolve = useCallback(
    async (variant) => {
      const res = await runly.identity.getUserAvatarSignedUrl(userId, token, { variant });
      return res?.data?.signedUrl ?? null;
    },
    [userId, token],
  );

  const { data: cardUrl } = useQuery({
    queryKey: ["identity-user-avatar", userId, "card", avatarUrl],
    queryFn: () => resolve("card"),
    enabled: Boolean(hasAvatar && token && userId),
    staleTime: SIGNED_URL_STALE_MS,
  });
  const { data: fullUrl } = useQuery({
    queryKey: ["identity-user-avatar", userId, "full", avatarUrl],
    queryFn: () => resolve("full"),
    enabled: Boolean(hasAvatar && token && userId && cardReady),
    staleTime: SIGNED_URL_STALE_MS,
  });

  useEffect(() => {
    setCardReady(false);
    if (!cardUrl) return undefined;
    const img = new Image();
    img.onload = () => setCardReady(true);
    img.src = cardUrl;
    return () => {
      img.onload = null;
    };
  }, [cardUrl]);

  useEffect(() => {
    if (!fullUrl) return;
    new Image().src = fullUrl;
  }, [fullUrl]);

  const resolveFull = useCallback(() => fullUrl ?? resolve("full"), [fullUrl, resolve]);

  const initials = String(displayName ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <>
      <button
        type="button"
        aria-label="Ver foto de perfil"
        title="Ver foto de perfil"
        disabled={!hasAvatar || isUploading}
        onClick={() => setViewerOpen(true)}
        className="group relative block shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none"
      >
        <Avatar className="h-20 w-20">
          {hasAvatar && (
            <AvatarImage
              src={cardReady ? cardUrl : avatarUrl}
              alt={displayName || "Foto de perfil"}
              className={cardReady ? "transition-[filter] duration-300" : "blur-[1px]"}
            />
          )}
          <AvatarFallback className="text-lg font-semibold">{initials}</AvatarFallback>
        </Avatar>
        {isUploading ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
            <span className="text-[10px] font-medium text-white">Subiendo</span>
          </div>
        ) : hasAvatar ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 transition-colors duration-150 group-hover:bg-black/30">
            <ZoomIn className="h-5 w-5 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </div>
        ) : null}
      </button>
      {hasAvatar && (
        <AdvancedFileViewer
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          files={[
            {
              id: `user-avatar-${userId}`,
              mimeType: "image/jpeg",
              originalName: displayName || "Foto de perfil",
              sizeBytes: 0,
            },
          ]}
          activeIndex={0}
          onIndexChange={() => {}}
          onResolveSignedUrl={resolveFull}
        />
      )}
    </>
  );
}

export default UserAvatarPreview;
