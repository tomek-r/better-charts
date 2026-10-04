// @ts-check
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import css from '@eslint/css';

// React Compiler rules come from the plugin's documented `recommended-latest`
// preset, downgraded to "warn" as a layer: full diagnostic visibility without
// forcing rewrites of frozen legacy code. The two documented core rules keep
// their preset severities untouched: rules-of-hooks=error, exhaustive-deps=warn
// (existing dependency arrays are frozen — changing them changes behavior).
const CORE_HOOK_RULES = new Set(['react-hooks/rules-of-hooks', 'react-hooks/exhaustive-deps']);
const compilerRulesAsWarn = Object.fromEntries(
  Object.entries(reactHooks.configs.flat['recommended-latest'].rules)
    .filter(([rule]) => !CORE_HOOK_RULES.has(rule))
    .map(([rule]) => [rule, 'warn']),
);

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'target', 'playwright-report', 'test-results', 'src-tauri', 'mql5'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended, react.configs.flat['jsx-runtime'], reactHooks.configs.flat.recommended],
    settings: { react: { version: 'detect' } },
    rules: {
      ...compilerRulesAsWarn,
      'no-nested-ternary': 'error',
      'react/prop-types': 'off',
      // `_`-prefixed unused parameters are the sanctioned marker (task contract).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // The chart directory was split out of one 945-line controller. Cap file size
  // so it cannot decay back into one: the largest file is now the orchestrator at
  // a little over 300 counted lines, and a file that outgrows this should be split
  // rather than have the limit raised. Blank lines and comments are free, so the
  // budget is spent on code, and the long option blocks in the factories are not
  // penalised for documenting why each value is what it is.
  {
    files: ['src/features/chart/engine/**/*.ts'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  // Plain CSS linting via the official @eslint/css language plugin. The
  // recommended preset validates at-rules/properties, duplicate imports,
  // empty blocks and Baseline feature support.
  {
    files: ['**/*.css'],
    language: 'css/css',
    extends: [css.configs.recommended],
    rules: {
      // Design tokens are declared in tokens.css and applied per stylesheet;
      // files are linted independently, so cross-file custom properties cannot
      // be resolved. Property/value validation stays enabled.
      'css/no-invalid-properties': ['error', { allowUnknownVariables: true }],
      // Features used deliberately and shipped by the Tauri WebView targets
      // (WebKit on macOS, WebView2 on Windows) that the bundled Baseline data
      // does not (yet) mark as widely available.
      'css/use-baseline': [
        'error',
        {
          allowProperties: ['scrollbar-width', 'accent-color'],
          allowPropertyValues: { 'font-family': ['ui-sans-serif'] },
        },
      ],
    },
  },
  // Keep last: disables all formatting-compatible ESLint rules.
  prettier,
  // This clarity rule is intentionally re-enabled after the Prettier config.
  { rules: { curly: ['error', 'all'] } },
);
