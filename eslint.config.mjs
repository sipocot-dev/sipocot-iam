// @ts-check
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

/** Libraries that must never leak into the inner (domain / application) layers. */
const FRAMEWORK_AND_IO = [
  'next',
  'next/*',
  'react',
  'react-dom',
  'drizzle-orm',
  'drizzle-orm/*',
  'postgres',
  'ioredis',
  'pino',
  '@aws-sdk/*',
  '@node-rs/*',
  'prom-client',
  '@opentelemetry/*',
];

const restrict = (/** @type {string[]} */ groups, /** @type {string} */ message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: groups, message }] }],
});

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'drizzle/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...nextVitals,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ['*.mjs'] }, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  { files: ['**/*.mjs'], ...tseslint.configs.disableTypeChecked },

  // ── Architecture boundaries (Hexagonal / Clean) ────────────────────────────
  // domain  ← application ← infrastructure / interface ← composition / app
  {
    files: ['src/shared/domain/**', 'src/modules/*/domain/**'],
    rules: restrict(
      [
        '**/application',
        '**/application/**',
        '**/infrastructure',
        '**/infrastructure/**',
        '**/interface',
        '**/interface/**',
        '@/composition/**',
        'zod',
        ...FRAMEWORK_AND_IO,
      ],
      'Domain layer must be pure: no application, infrastructure, framework or I/O imports.',
    ),
  },
  {
    files: ['src/shared/application/**', 'src/modules/*/application/**'],
    rules: restrict(
      [
        '**/infrastructure',
        '**/infrastructure/**',
        '**/interface',
        '**/interface/**',
        '@/composition/**',
        ...FRAMEWORK_AND_IO,
      ],
      'Application layer depends only on domain and ports; adapters live in infrastructure.',
    ),
  },
  {
    files: ['src/shared/infrastructure/**', 'src/modules/*/infrastructure/**'],
    rules: restrict(
      ['**/interface', '**/interface/**', '@/composition/**', 'next', 'next/*', 'react'],
      'Infrastructure adapters must not depend on delivery mechanisms.',
    ),
  },
  {
    files: ['src/app/**'],
    rules: restrict(
      ['@/modules/*/infrastructure/**', '@/shared/infrastructure/db/**', '@/shared/infrastructure/redis/**'],
      'Route handlers talk to use cases through the composition root, never to adapters directly.',
    ),
  },
  {
    files: ['scripts/**', 'tests/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
