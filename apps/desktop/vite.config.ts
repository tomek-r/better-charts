import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { checker } from 'vite-plugin-checker';
import pkg from './package.json' with { type: 'json' };

// Cross-language pair: `window_title` in `src-tauri/src/lib.rs` formats the
// native window title the same way.
const appTitle = (version: string) => `Better Charts v${version}`;

export default defineConfig({
  plugins: [
    // Writes the versioned title into the built HTML so it is right before any JS runs.
    {
      name: 'app-title',
      transformIndexHtml: (html) => html.replace(/<title>[^<]*<\/title>/, `<title>${appTitle(pkg.version)}</title>`),
    },
    react(),
    // React Compiler: auto-memoise components and hooks so a re-render can
    // skip a subtree whose inputs are unchanged. React 19 needs no runtime
    // shim (the compiler uses the built-in memo cache). The bundle grows by
    // ~35 kB raw, which is a disk cost here, not a network one.
    babel({ presets: [reactCompilerPreset()] }),
    // Fail fast on code changes: TS + ESLint diagnostics as a dev overlay.
    // enableBuild is off because `pnpm build` already runs `tsc --noEmit`
    // and `pnpm check` gates ESLint/Prettier.
    checker({
      typescript: true,
      eslint: { lintCommand: 'eslint .' },
      enableBuild: false,
      // Panel stays collapsed for warnings; it auto-opens only on real errors,
      // so the dev overlay never blocks pointer events under Playwright.
      overlay: { initialIsOpen: 'error' },
    }),
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  // Single source of truth for the version shown in the UI (owner: 'nie
  // hardkoduj' — it is read from package.json at build time).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
