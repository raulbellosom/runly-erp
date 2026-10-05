// Minimal ESLint config: one guardrail rule, no style linting.
// `toISOString()` is always UTC; deriving a local date/month from it is a bug.
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-*/**",
      "apps/desktop/src-tauri/**",
      "prisma/migrations/**",
      "docs/**",
      "**/*.min.js",
      "**/.vite/**",
      "apps/api/bundles/**",
      "modules/custom/.previews/**",
    ],
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    linterOptions: { reportUnusedDisableDirectives: false },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // The codebase has many `// eslint-disable-next-line react-hooks/*` comments.
    // We don't lint hooks here, but ESLint 9 errors on disable-comments that
    // name an unknown rule, so register them as no-ops.
    plugins: {
      "react-hooks": {
        rules: {
          "exhaustive-deps": { create: () => ({}) },
          "rules-of-hooks": { create: () => ({}) },
        },
      },
    },
    rules: {
      // Every deliberate-UTC site carries an inline `eslint-disable ... -- <reason>`.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
          message:
            "toISOString() is UTC. Use toLocalIso()/toLocalMonth() from @runly/core to derive a local date/month.",
        },
        {
          selector:
            "CallExpression[callee.property.name='split'][callee.object.callee.property.name='toISOString']",
          message:
            "toISOString() is UTC. Use toLocalIso() from @runly/core to derive a local date.",
        },
      ],
    },
  },
];
