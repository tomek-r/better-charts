import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { palette, paletteVariableName } from '../src/shared/theme/palette';
import { paletteCss } from '../vite/paletteCss';
import { gotoWithStub } from './helpers/tauriStub';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory: string, extensions: readonly string[]): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path, extensions);
    }
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

// Pure node-fs guard (no browser): the palette is the only place a colour is defined.
test('every var(--color-*) used in src resolves to a palette entry', () => {
  const generated = new Set(Object.keys(palette).map(paletteVariableName));
  const missing: string[] = [];
  for (const file of sourceFiles(sourceRoot, ['.css', '.tsx'])) {
    for (const [, name] of readFileSync(file, 'utf8').matchAll(/var\(\s*(--color-[a-z0-9-]+)/g)) {
      if (!generated.has(name)) {
        missing.push(`${file}: ${name}`);
      }
    }
  }
  expect(missing).toEqual([]);
});

test('no stylesheet under src defines a --color-* variable', () => {
  const definitions: string[] = [];
  for (const file of sourceFiles(sourceRoot, ['.css'])) {
    for (const [, name] of readFileSync(file, 'utf8').matchAll(/(--color-[a-z0-9-]+)\s*:/g)) {
      definitions.push(`${file}: ${name}`);
    }
  }
  expect(definitions).toEqual([]);
});

test('the generated stylesheet declares every palette entry once', () => {
  const css = paletteCss();
  for (const [key, value] of Object.entries(palette)) {
    expect(css).toContain(`  ${paletteVariableName(key)}: ${value};\n`);
  }
  expect(css.match(/--color-[a-z0-9-]+:/g)).toHaveLength(Object.keys(palette).length);
});

test('the page exposes the palette values as computed custom properties', async ({ page }) => {
  await gotoWithStub(page);
  const computed = await page.evaluate((names) => {
    const style = getComputedStyle(document.documentElement);
    return names.map((name) => style.getPropertyValue(name).trim());
  }, Object.keys(palette).map(paletteVariableName));
  expect(computed).toEqual(Object.values(palette));
});
