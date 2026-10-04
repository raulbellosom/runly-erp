import { SlidersHorizontal } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "@runly/ui";

// "Personalizar": one switch per widget the user can see.
export function HomeWidgetCustomizer({ widgets, hidden, onToggle }) {
  if (widgets.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal size={14} aria-hidden />
          Personalizar
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-[hsl(var(--border))] px-4 py-3">
          <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Widgets de inicio</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Elige qué resúmenes ver en tu inicio.
          </p>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {widgets.map((w) => {
            const id = `home-widget-${w.id}`;
            return (
              <li key={w.id}>
                <label
                  htmlFor={id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-[hsl(var(--muted))]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[hsl(var(--foreground))]">{w.title}</span>
                    <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {w.description}
                    </span>
                  </span>
                  <Switch
                    id={id}
                    checked={!hidden.includes(w.id)}
                    onCheckedChange={() => onToggle(w.id)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function HomeWidgetBoard({ widgets, modulesByKey }) {
  if (widgets.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {widgets.map(({ id, moduleKey, Component }) => (
        <Component key={id} module={modulesByKey.get(moduleKey)} />
      ))}
    </div>
  );
}
