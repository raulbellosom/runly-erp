import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../Card.jsx";
import { cn } from "../../lib/utils.js";

const GRID_COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

// Responsive field grid: one column on phones, `columns` from md up. A child
// can span the full row with className="md:col-span-2" (or col-span-full).
export function FieldGrid({ columns = 2, className, children }) {
  return <div className={cn("grid gap-4", GRID_COLUMNS[columns] ?? GRID_COLUMNS[2], className)}>{children}</div>;
}

// A titled card section of a form or detail screen, with a lucide icon, so
// long forms read as groups instead of one field under another.
export function FormSection({ title, description, icon: Icon, columns = 2, actions, className, children }) {
  return (
    <Card className={className}>
      {(title || description || actions) && (
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0 space-y-1">
            {title && (
              <CardTitle className="flex items-center gap-2 text-base">
                {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
                {title}
              </CardTitle>
            )}
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent>
        <FieldGrid columns={columns}>{children}</FieldGrid>
      </CardContent>
    </Card>
  );
}
