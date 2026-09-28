import { Tabs, TabsList, TabsTrigger } from "../components/Tabs.jsx";

// Controlled tab bar for RunlyForm / RunlyDetail (see schema-tabs.js). The
// panels are rendered by the caller so a form can keep every tab mounted.
export function SchemaTabBar({ tabs, activeKey, onChange, errorKeys = null }) {
  if (!tabs?.length) return null;
  return (
    <Tabs value={activeKey} onValueChange={onChange}>
      <div className="max-w-full overflow-x-auto">
        <TabsList className="justify-start">
          {tabs.map((tab) => {
            const hasError = Boolean(errorKeys?.has(tab.key));
            return (
              <TabsTrigger key={tab.key} value={tab.key} className="gap-1.5">
                {tab.label}
                {hasError ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-red-500"
                    aria-label="Contiene errores"
                  />
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
    </Tabs>
  );
}
