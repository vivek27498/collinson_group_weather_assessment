/**
 * Two projects so CI (and humans) can run the fast, hermetic unit suite on its own
 * and the slower integration suite (real MySQL via Testcontainers) separately.
 * @type {import('jest').Config}
 */
const tsJest = ['ts-jest', { tsconfig: 'tsconfig.json' }];

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
      transform: { '^.+\\.ts$': tsJest },
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      transform: { '^.+\\.ts$': tsJest },
      testTimeout: 120_000,
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  coverageThreshold: {
    global: { branches: 85, functions: 85, lines: 85, statements: 85 },
  },
};
