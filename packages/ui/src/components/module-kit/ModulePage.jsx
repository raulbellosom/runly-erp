import { PageHeader } from "../PageHeader.jsx";
import { cn } from "../../lib/utils.js";

// Standard module screen: PageHeader + responsive padded body. Use it as the
// root of every CUSTOM screen (spec 2026-10-03-rme3-module-platform-v2 §5.4).
// `icon` is a lucide component shown before the title.
export function ModulePage({ title, description, icon: Icon, actions, onBack, children, className }) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6", className)}>
      <PageHeader
        title={Icon ? (
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            {title}
          </span>
        ) : title}
        description={description}
        actions={actions}
        onBack={onBack}
      />
      {children}
    </div>
  );
}
