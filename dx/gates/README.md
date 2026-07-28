# Quality gates

Executable quality contracts live here. Names describe what each gate measures:

- `stylesheet-structure.mjs`: rule count, duplicate declaration blocks, and token-scale violations.
- `test-file-lines.mjs`: test-file LOC report; warns above 1,000 lines by default.
- `development-test-duration.mjs`: parallel developer test lanes; fails above 10 seconds.

Use package entrypoints instead of invoking files directly:

- `npm run gate:styles`
- `npm run gate:test-loc`
- `npm run gate:dev-time`
- `npm run gate:performance`

Runner-native gates remain beside their runner configuration:

- TypeScript: `typecheck` uses `tsgo`; `typecheck:release` uses `tsc`.
- Coverage: `vitest.coverage.config.ts` for development; `vitest.config.ts` for release.
- Browser: `playwright.fast.config.cjs` for development; `playwright.config.cjs` for release.
- DX behavior: `dx/selftest.mjs`.

Overrides use explicit units: `DEVELOPMENT_TEST_BUDGET_MS`,
`TEST_FILE_LINE_WARNING`, and `TEST_FILE_LINE_ENFORCE=1`. Previous environment
names remain accepted for compatibility.
