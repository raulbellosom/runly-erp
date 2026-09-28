// CARDS records view: responsive grid of record cards. Image fields hold a
// fileAssetId, resolved to a signed URL through the injected resolveImage.
import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { accentFor, fieldMap, formatFieldValue } from "./records-view-format.js";

function CardImage({ fileId, resolveImage, alt }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (fileId && resolveImage) resolveImage(String(fileId)).then((next) => { if (!cancelled) setUrl(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [fileId, resolveImage]);
  return (
    <div className="aspect-video w-full overflow-hidden bg-[hsl(var(--muted))]">
      {url
        ? <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-[hsl(var(--muted-foreground))]"><ImageIcon className="h-6 w-6" /></div>}
    </div>
  );
}

export function RunlyCardsView({ schema, data, onOpen, resolveImage }) {
  const fields = fieldMap(data.fields);
  const card = schema.card ?? {};
  const title = fields.get(card.titleField);
  const subtitle = fields.get(card.subtitleField);
  const description = fields.get(card.descriptionField);
  const badge = fields.get(card.badgeField);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {data.records.map((record) => {
        const Wrapper = onOpen ? "button" : "div";
        return (
          <Wrapper
            key={record.id}
            type={onOpen ? "button" : undefined}
            onClick={onOpen ? () => onOpen(record.id) : undefined}
            className={`group flex flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-left shadow-sm transition-all duration-150 ${onOpen ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" : ""}`}
          >
            {card.imageField && <CardImage fileId={record[card.imageField]} resolveImage={resolveImage} alt={formatFieldValue(title, record[card.titleField])} />}
            <div className="flex flex-1 flex-col gap-1.5 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold">{formatFieldValue(title, record[card.titleField])}</p>
                {badge && record[card.badgeField] != null && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs font-medium">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentFor(badge, record[card.badgeField]) }} />
                    {formatFieldValue(badge, record[card.badgeField])}
                  </span>
                )}
              </div>
              {subtitle && <p className="truncate text-sm text-[hsl(var(--muted-foreground))]">{formatFieldValue(subtitle, record[card.subtitleField])}</p>}
              {description && <p className="line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]">{formatFieldValue(description, record[card.descriptionField])}</p>}
            </div>
          </Wrapper>
        );
      })}
    </div>
  );
}
