# Test core

Tests use one vocabulary across real-browser and jsdom lanes:

- `setup` boots isolated state (`setup.app`, plus browser demo/mobile/flag variants).
- `steps` performs user or command actions.
- `checks` owns repeated polling and domain assertions.

Browser specs import from `browser-testkit.cjs`; command specs import from
`commands/testkit.ts`. Add shared behavior there after its third use instead of
copying setup, polling, or teardown into a spec.

## Gates

- `npm test`: parallel developer unit and browser lanes; fails above 10 seconds.
- `npm run gate:test-loc`: reports test LOC and warns when a file exceeds 1,000 lines.
- `npm run test:commands:coverage`: focused developer coverage.
- `npm run test:release`: exhaustive coverage and browser journeys.
