import { ModuleRuntimeProvider } from "@runly/ui";

// Renders a module's CUSTOM component inside the module runtime (spec
// 2026-10-03-rme3-module-platform-v2 §5.4), so its screens can use
// useEntity*/EntityTable/EntityForm/EntityDetail without threading the
// session. The legacy props (token, companyId, apiBaseUrl, navigate,
// moduleKey) are still passed for existing modules.
export function CustomViewHost({ component: CustomComponent, moduleKey, token, companyId, apiBaseUrl, navigate, blueprints }) {
  return (
    <ModuleRuntimeProvider
      moduleKey={moduleKey}
      token={token}
      companyId={companyId}
      apiBaseUrl={apiBaseUrl}
      navigate={navigate}
      blueprints={blueprints}
    >
      {/* data-runly-module scopes the module's own Tailwind CSS (bundle.css). */}
      <div className="h-full min-h-0 w-full overflow-auto" data-runly-module={moduleKey}>
        <CustomComponent
          token={token}
          companyId={companyId}
          apiBaseUrl={apiBaseUrl}
          navigate={navigate}
          moduleKey={moduleKey}
        />
      </div>
    </ModuleRuntimeProvider>
  );
}
