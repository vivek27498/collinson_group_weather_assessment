// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import prettier from 'eslint-config-prettier';

/**
 * SQL-injection guard rails (see docs/decisions/ADR-004-security-baseline.md).
 * Prisma's tagged-template `$queryRaw` / `$executeRaw` bind every interpolated value
 * as a parameter. The *Unsafe variants and `Prisma.raw` splice strings into SQL,
 * so they are banned outright: a reviewer should never have to spot them by eye.
 */
const sqlInjectionGuards = {
  'no-restricted-properties': [
    'error',
    {
      property: '$queryRawUnsafe',
      message: 'Unsafe raw SQL is banned. Use the tagged template $queryRaw`...` (parameterised).',
    },
    {
      property: '$executeRawUnsafe',
      message:
        'Unsafe raw SQL is banned. Use the tagged template $executeRaw`...` (parameterised).',
    },
    {
      object: 'Prisma',
      property: 'raw',
      message: 'Prisma.raw splices strings into SQL. Use Prisma.sql`...` with bound values.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'src/generated/', 'load/k6/'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.mjs', 'prisma.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...sqlInjectionGuards,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['test/**/*.ts', 'load/**/*.ts'],
    rules: {
      // Tests index into fixtures and build objects dynamically; these rules add noise there.
      'security/detect-object-injection': 'off',
      // Tests read fixture files whose names come from a closed union type, never from input.
      'security/detect-non-literal-fs-filename': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  prettier,
);
