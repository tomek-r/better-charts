import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { installTauriStub, pushEvent } from '../e2e/helpers/tauriStub';

/**
 * React profiler scenario. Drives a fixed interaction sequence and records what
 * can be observed on that build, labelled per step, so the same scenario can be
 * run against another branch or another build type and compared.
 *
 * What it collects, and where it survives:
 *
 * | metric | dev | production |
 * | --- | --- | --- |
 * | commit count, components that performed work | yes | yes |
 * | commit time, per-component self time | yes | **no** — React compiles the profiler timer out, so `actualDuration` is absent |
 * | boot timing (navigation, first paint, chart ready) | yes | yes |
 * | wall clock per interaction | yes | yes |
 * | long tasks (>50 ms) during the scenario | yes | yes |
 *
 * Env: PROFILER_OUT (output path), PROFILER_BASE (another dev/preview server),
 * PROFILER_MODE (label recorded in the output: dev | prod).
 */

const HOOK = `
(() => {
  const commits = [];
  let label = 'pre-mount';
  const longTasks = { count: 0, totalMs: 0, maxMs: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.count += 1;
        longTasks.totalMs += entry.duration;
        longTasks.maxMs = Math.max(longTasks.maxMs, entry.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (error) { /* older engines: no long-task data */ }

  const hook = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot(_id, root) { try { record(root); } catch (error) { /* keep the run alive */ } },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  window.__profiler = { commits, longTasks, mark(next) { label = next; } };

  function shallowEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const key of ka) if (a[key] !== b[key]) return false;
    return true;
  }

  function componentName(fiber) {
    const type = fiber.elementType || fiber.type;
    if (!type || typeof type === 'string') return null;
    const inner = type.type || type.render;
    return (inner && (inner.displayName || inner.name)) || type.displayName || type.name || 'Anonymous';
  }

  function record(root) {
    const stats = new Map();
    let rendered = 0;
    let commitDur = 0;
    let memoable = 0; // components whose props are shallow-equal to last render
    const walk = (node) => {
      let fiber = node;
      while (fiber) {
        const dur = fiber.actualDuration || 0; // absent in production builds
        const didWork = (fiber.flags & 1) !== 0; // PerformedWork
        if (fiber === root.current) commitDur = dur;
        const name = didWork ? componentName(fiber) : null;
        if (name) {
          // memo (and the React Compiler) would skip a component whose props are
          // shallow-equal to its previous render: fiber.alternate holds those.
          const previous = fiber.alternate && fiber.alternate.memoizedProps;
          if (previous && shallowEqual(previous, fiber.memoizedProps)) memoable += 1;
          let childDur = 0;
          let child = fiber.child;
          while (child) { childDur += child.actualDuration || 0; child = child.sibling; }
          const entry = stats.get(name) || { count: 0, self: 0 };
          entry.count += 1;
          entry.self += Math.max(0, dur - childDur);
          stats.set(name, entry);
          rendered += 1;
        }
        if (fiber.child) walk(fiber.child);
        fiber = fiber.sibling;
      }
    };
    walk(root.current);
    commits.push({
      label,
      at: Math.round(performance.now()),
      commitDur: Number(commitDur.toFixed(3)),
      rendered,
      memoable,
      components: Object.fromEntries(
        [...stats].map(([k, v]) => [k, { count: v.count, self: Number(v.self.toFixed(3)) }]),
      ),
    });
  }
})();
`;

test('profiler scenario', async ({ page }) => {
  test.setTimeout(180_000);
  const out = process.env.PROFILER_OUT ?? '/tmp/profiler.json';
  const mode = process.env.PROFILER_MODE ?? 'dev';
  const steps: string[] = [];
  const walls: Record<string, number> = {};

  const mark = async (label: string) => {
    steps.push(label);
    await page.evaluate(
      (next) => (window as unknown as { __profiler: { mark(l: string): void } }).__profiler.mark(next),
      label,
    );
  };
  const maybe = async (label: string, run: () => Promise<void>) => {
    const started = Date.now();
    try {
      await run();
    } catch {
      steps.push(`${label}:skipped`);
    }
    walls[label] = Date.now() - started;
  };

  await page.addInitScript(HOOK);
  await installTauriStub(page);

  // boot: navigation to a settled shell, then to a live chart host
  const bootStart = Date.now();
  const base = process.env.PROFILER_BASE;
  await page.goto(base ? `${base}/` : '/');
  await page.waitForSelector('.topbar', { timeout: 20_000 });
  const shellMs = Date.now() - bootStart;
  let chartMs: number | undefined;
  const chartStart = Date.now();
  try {
    await page.waitForSelector('.chart-frame canvas', { timeout: 8000 });
    chartMs = Date.now() - chartStart;
  } catch {
    chartMs = undefined;
  }
  const navigation = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      domInteractive: nav ? Math.round(nav.domInteractive) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      firstPaint: paint ? Math.round(paint.startTime) : null,
    };
  });
  await page.waitForTimeout(1500);

  const symbol = (await page.locator('.chart-heading h1').first().innerText()).trim();

  await mark('idle');
  await maybe('idle', async () => {
    await page.waitForTimeout(800);
  });

  await mark('quotes');
  await maybe('quotes', async () => {
    for (let i = 0; i < 12; i++) {
      await pushEvent(page, 'quote-update', {
        symbol,
        timeMs: 1745700000000 + i * 1000,
        bid: '1.08520',
        ask: '1.08530',
        last: '1.08525',
        volume: 1,
        volumeReal: '1',
        flags: 6,
      });
    }
    await page.waitForTimeout(900);
  });

  await mark('panel');
  await maybe('panel', async () => {
    for (let i = 0; i < 2; i++) {
      await page.getByLabel('Toggle trade panel').click();
      await page.waitForTimeout(400);
    }
  });

  await mark('settings');
  await maybe('settings', async () => {
    await page.getByLabel('App settings').click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });

  await mark('tools');
  await maybe('tools', async () => {
    await page.getByLabel('Pointer tools').click();
    await page.waitForTimeout(300);
    await page.getByRole('menuitemradio', { name: 'Crosshair pointer' }).click({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await mark('ticket');
  await maybe('ticket', async () => {
    await page.getByLabel('Toggle trade panel').click();
    await page.waitForTimeout(400);
    await page.locator('.ticket-quote-side.sell').click();
    await page.waitForTimeout(400);
    await page.locator('.ticket-quote-side.buy').click();
    await page.waitForTimeout(400);
  });

  await mark('timeframe');
  await maybe('timeframe', async () => {
    await page.locator('.timeframe-tabs button', { hasText: '15m' }).first().click();
    await page.waitForTimeout(1500);
  });

  await mark('search');
  await maybe('search', async () => {
    await page.locator('.search-trigger').click();
    await page.waitForTimeout(400);
    await page.locator('.search-panel input').first().fill('EUR');
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await mark('done');
  const { commits, longTasks } = await page.evaluate(() => {
    const profiler = (window as unknown as { __profiler: { commits: unknown[]; longTasks: unknown } }).__profiler;
    return { commits: profiler.commits, longTasks: profiler.longTasks };
  });
  const memory = await page.evaluate(() => {
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
    return perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1024) : null;
  });

  writeFileSync(
    out,
    JSON.stringify(
      { mode, boot: { shellMs, chartMs }, navigation, steps, walls, longTasks, memoryKb: memory, commits },
      null,
      1,
    ),
  );
});
