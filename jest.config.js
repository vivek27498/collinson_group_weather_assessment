/**
 * Two projects so CI (and humans) can run the fast, hermetic unit suite on its own
 * and the slower integration suite (real MySQL via Testcontainers) separately.
 * @type {import('jest').Config}
 */
const tsJest = ['ts-jest', { tsconfig: 'tsconfig.json' }];

// The generated Prisma client imports './x.js' that actually points at './x.ts' (NodeNext style).
// TypeScript and tsx resolve that; Jest needs to be told.
const moduleNameMapper = { '^(\\.{1,2}/.*)\\.js$': '$1' };

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
      transform: { '^.+\\.ts$': tsJest },
      moduleNameMapper,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      transform: { '^.+\\.ts$': tsJest },
      moduleNameMapper,
      testTimeout: 120_000,
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/generated/**'],
  coverageThreshold: {
    global: { branches: 85, functions: 85, lines: 85, statements: 85 },
  },
};
