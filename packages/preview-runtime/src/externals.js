export const MODULE_EXTERNALS_IMPORTMAP = {
  "react":                  "ext-react",
  "react-dom":              "ext-react-dom",
  "react/jsx-runtime":      "ext-react-jsx-runtime",
  "react/jsx-dev-runtime":  "ext-react-jsx-dev-runtime",
  "@tanstack/react-query":  "ext-tanstack-react-query",
  "zustand":                "ext-zustand",
  "@runly/ui":              "ext-atlas-ui",
  "@runly/sdk":             "ext-atlas-sdk",
  "@runly/validators":      "ext-atlas-validators",
  "@atlas/ui":              "ext-atlas-ui",
  "@atlas/sdk":             "ext-atlas-sdk",
  "@atlas/validators":      "ext-atlas-validators",
  "react-router-dom":       "ext-react-router-dom",
  "sonner":                 "ext-sonner",
  "lucide-react":           "ext-lucide-react",
  "recharts":               "ext-recharts",
  "qrcode":                 "ext-qrcode",
  "@zxing/browser":         "ext-zxing-browser",
};
export const BUNDLE_EXTERNALS = Object.freeze(Object.keys(MODULE_EXTERNALS_IMPORTMAP));
export const BUNDLE_EXTERNAL_URL_PATTERNS = Object.freeze(['https://*']);
