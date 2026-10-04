# Home widgets — implementation plan

Spec: `docs/superpowers/specs/2026-10-03-home-widgets-design.md`

1. `apps/desktop/src/app/home/HomeHeader.jsx` replaces `HomeHero.jsx`: light header,
   compact search, recents chips, "Personalizar" popover slot.
2. `apps/desktop/src/hooks/useHomeWidgetPrefs.js` + pure helper
   `lib/homeWidgets.js` (`visibleWidgets(catalog, availableKeys, hidden)`, `toggleHidden`) with a unit test.
3. `apps/desktop/src/app/home/widgets/`: `WidgetFrame.jsx` (shared chrome + states),
   one file per widget, `registry.js` (catalog: id, title, moduleKey, Component).
4. `HomeWidgetBoard.jsx` (grid) + `HomeWidgetCustomizer.jsx` (Popover + Switches).
5. Wire into `HomeScreen.jsx`; remove `HomeHero.jsx`.
6. Verify: unit tests, eslint, `vite build`, Playwright screenshots (light/dark/mobile)
   on the E2E test company.
