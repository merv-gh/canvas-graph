export const fastCommandTests = [
  'tests/commands/model-core.test.ts',
  'tests/commands/command-smoke.test.ts',
  'tests/commands/journey-smoke.test.ts',
  'tests/commands/redraw-convention.test.ts',
];

export const coverageCommandTests = [
  ...fastCommandTests,
  'tests/commands/architecture-journey.test.ts',
  'tests/commands/recorded/reverse-edge.test.ts',
];
