import type { Plugin } from 'vite';
import { palette, paletteVariableName } from '../src/shared/theme/palette.ts';

const MODULE_ID = 'virtual:palette.css';
// The trailing `.css` makes Vite run the module through its CSS pipeline (dev
// style injection, build-time CSS extraction); the `\0` prefix marks it virtual.
const RESOLVED_ID = `\0${MODULE_ID}.css`;

/** The `:root` rule that exposes every palette entry as a `--color-*` custom property. */
export function paletteCss(colors: Readonly<Record<string, string>> = palette): string {
  const declarations = Object.entries(colors).map(([key, value]) => `  ${paletteVariableName(key)}: ${value};`);
  return `:root {\n${declarations.join('\n')}\n}\n`;
}

/**
 * Serves `virtual:palette.css`, generated from `src/shared/theme/palette.ts`.
 * palette.ts is imported by the Vite config, so editing it restarts the dev
 * server and the regenerated variables reach the page.
 */
export function palettePlugin(): Plugin {
  return {
    name: 'palette-css',
    resolveId: (id) => (id === MODULE_ID ? RESOLVED_ID : undefined),
    load: (id) => (id === RESOLVED_ID ? paletteCss() : undefined),
  };
}
