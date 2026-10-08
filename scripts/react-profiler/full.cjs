const fs = require("node:fs");
const path = require("node:path");

// PerformedWork, Fiber.actualStartTime, and Fiber.actualDuration are private React implementation details.
// Bit 0 is PerformedWork in the pinned React used by this comparison; revisit this
// reader when React changes. Prop categories compare only previous/current props:
// unchanged props do not prove memoizability or explain state/context renders.
const PROFILE_INIT = `
(() => {
  const state = {
    currentPhase: "startup",
    phases: [{ name: "startup", start: performance.now(), end: null, profilerStart: 0, fiberStart: 0 }],
    fibers: [],
    longTasks: [],
    observerErrors: [],
    observerSupported: false,
    longTaskObserver: null,
  };
  window.__reactFullProfile = true;
  window.__reactProfile = [];

  const errorText = (error) => error instanceof Error ? error.stack || error.message : String(error);
  const recordLongTask = (entry) => {
    try {
      state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    } catch (error) {
      state.observerErrors.push(errorText(error));
    }
  };
  try {
    const supported = PerformanceObserver.supportedEntryTypes || [];
    if (!supported.includes("longtask")) throw new Error("PerformanceObserver longtask entries are unavailable.");
    state.longTaskObserver = new PerformanceObserver((list) => {
      try { for (const entry of list.getEntries()) recordLongTask(entry); }
      catch (error) { state.observerErrors.push(errorText(error)); }
    });
    state.longTaskObserver.observe({ type: "longtask", buffered: true });
    state.observerSupported = true;
  } catch (error) {
    state.observerErrors.push(errorText(error));
  }

  const shallowProps = (previous, next) => {
    if (previous === next) return { category: "props_unchanged", changed: [] };
    if (!previous || !next || typeof previous !== "object" || typeof next !== "object") {
      return { category: "props_changed", changed: [] };
    }
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    const changed = [...keys].filter((key) => previous[key] !== next[key]);
    return { category: changed.length ? "props_changed" : "props_unchanged", changed };
  };
  const nameOf = (fiber) => {
    const type = fiber.elementType || fiber.type;
    if (!type || typeof type === "string") return null;
    const inner = type.type || type.render;
    return (inner && (inner.displayName || inner.name)) || type.displayName || type.name || "Anonymous";
  };
  const recordRoot = (rendererId, root) => {
    const components = new Map();
    const current = root && root.current;
    if (!current) throw new Error("React committed a root without a current Fiber tree.");
    const profilerSamples = window.__reactProfile;
    let appProfilerSampleIndex = -1;
    for (let index = profilerSamples.length - 1; index >= 0; index--) {
      if (profilerSamples[index].id === "app") {
        appProfilerSampleIndex = index;
        break;
      }
    }
    const appProfilerSample = appProfilerSampleIndex < 0
      ? null
      : profilerSamples[appProfilerSampleIndex];
    const appWindowAvailable = appProfilerSample !== null
      && Number.isFinite(appProfilerSample.startTime)
      && Number.isFinite(appProfilerSample.commitTime)
      && appProfilerSample.startTime <= appProfilerSample.commitTime;
    const isInAppRender = (fiber) => appWindowAvailable
      && Number.isFinite(fiber.actualStartTime)
      && fiber.actualStartTime >= appProfilerSample.startTime
      && fiber.actualStartTime <= appProfilerSample.commitTime;
    let performedWorkNodes = 0;
    let matchedPerformedWorkNodes = 0;
    let stalePerformedWorkNodes = 0;
    let missingActualStartTimeNodes = 0;
    let privateStartTimersAvailable = false;
    const performedWorkStartTimes = [];
    const matchedPerformedWorkStartTimes = [];
    const visit = (first) => {
      let fiber = first;
      while (fiber) {
        if (Number.isFinite(fiber.actualStartTime)) privateStartTimersAvailable = true;
        const performedWork = (fiber.flags & 1) !== 0;
        const inAppRender = isInAppRender(fiber);
        if (performedWork) {
          performedWorkNodes++;
          performedWorkStartTimes.push(Number.isFinite(fiber.actualStartTime) ? fiber.actualStartTime : null);
          if (!Number.isFinite(fiber.actualStartTime)) missingActualStartTimeNodes++;
          else if (!inAppRender) stalePerformedWorkNodes++;
          else matchedPerformedWorkStartTimes.push(fiber.actualStartTime);
        }
        if (performedWork && inAppRender) {
          matchedPerformedWorkNodes++;
          const name = nameOf(fiber);
          if (name) {
            const previous = fiber.alternate && fiber.alternate.memoizedProps;
            const comparison = fiber.alternate
              ? shallowProps(previous, fiber.memoizedProps)
              : { category: "initial_mount", changed: [] };
            const durationAvailable = Number.isFinite(fiber.actualDuration);
            // Estimate self time by subtracting only children rendered in this
            // same app Profiler window; stale child durations belong to earlier commits.
            let childDuration = 0;
            let childrenDurationAvailable = true;
            let child = fiber.child;
            while (child) {
              if (isInAppRender(child)) {
                if (Number.isFinite(child.actualDuration)) childDuration += child.actualDuration;
                else childrenDurationAvailable = false;
              }
              child = child.sibling;
            }
            const item = components.get(name) || {
              performedWork: 0,
              selfDurationMs: 0,
              timingAvailable: true,
              propComparisons: { props_changed: 0, props_unchanged: 0, initial_mount: 0 },
              changedPropNames: {},
              actualStartTimes: [],
              actualDurations: [],
            };
            item.performedWork++;
            item.actualStartTimes.push(fiber.actualStartTime);
            item.actualDurations.push(Number.isFinite(fiber.actualDuration) ? fiber.actualDuration : null);
            const selfDurationAvailable = durationAvailable && childrenDurationAvailable;
            item.timingAvailable &&= selfDurationAvailable;
            if (selfDurationAvailable) item.selfDurationMs += Math.max(0, fiber.actualDuration - childDuration);
            item.propComparisons[comparison.category] = (item.propComparisons[comparison.category] || 0) + 1;
            for (const prop of comparison.changed) item.changedPropNames[prop] = (item.changedPropNames[prop] || 0) + 1;
            components.set(name, item);
          }
        }
        if (fiber.child) visit(fiber.child);
        fiber = fiber.sibling;
      }
    };
    visit(current);
    const profilerWindow = appWindowAvailable
      ? {
          sampleIndex: appProfilerSampleIndex,
          phase: appProfilerSample.phase,
          startTime: appProfilerSample.startTime,
          commitTime: appProfilerSample.commitTime,
          actualDurationMs: appProfilerSample.actualDuration,
        }
      : null;
    const fiberTimingAvailable = privateStartTimersAvailable
      && appWindowAvailable
      && (matchedPerformedWorkNodes > 0 || appProfilerSample.actualDuration === 0)
      && missingActualStartTimeNodes === 0;
    let timingUnavailableReason = null;
    if (!privateStartTimersAvailable) timingUnavailableReason = "Fiber actualStartTime is unavailable in this React build.";
    else if (!appWindowAvailable) timingUnavailableReason = "No valid app Profiler start/commit window was available at the Fiber commit.";
    else if (missingActualStartTimeNodes > 0) timingUnavailableReason = "PerformedWork Fibers were missing actualStartTime.";
    else if (matchedPerformedWorkNodes === 0 && appProfilerSample.actualDuration !== 0) timingUnavailableReason = "No PerformedWork Fibers matched the current app Profiler render window.";
    const rootDuration = isInAppRender(current) && Number.isFinite(current.actualDuration)
      ? current.actualDuration
      : null;
    state.fibers.push({
      phase: state.currentPhase,
      at: performance.now(),
      rendererId,
      rootActualStartTime: Number.isFinite(current.actualStartTime) ? current.actualStartTime : null,
      appProfilerWindow: profilerWindow,
      fiberTimingAvailable,
      timingUnavailableReason,
      timingDiagnostics: {
        performedWorkNodes,
        matchedPerformedWorkNodes,
        stalePerformedWorkNodes,
        missingActualStartTimeNodes,
        privateStartTimersAvailable,
        performedWorkStartTimes,
        matchedPerformedWorkStartTimes,
      },
      rootActualDurationMs: fiberTimingAvailable ? rootDuration : null,
      components: Object.fromEntries([...components].map(([name, item]) => [name, {
        performedWork: item.performedWork,
        selfDurationMs: item.timingAvailable ? Number(item.selfDurationMs.toFixed(4)) : null,
        timingAvailable: item.timingAvailable,
        propComparisons: item.propComparisons,
        changedPropNames: item.changedPropNames,
        actualStartTimes: item.actualStartTimes,
        actualDurations: item.actualDurations,
      }])),
    });
  };
  const hook = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot(id, root) {
      try { recordRoot(id, root); }
      catch (error) { state.observerErrors.push(errorText(error)); }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  const flushTasks = () => {
    if (state.longTaskObserver) for (const entry of state.longTaskObserver.takeRecords()) recordLongTask(entry);
  };
  window.__reactFullProfileState = state;
  window.__reactFullProfileApi = {
    begin(name) {
      flushTasks();
      const phase = {
        name,
        start: performance.now(),
        end: null,
        profilerStart: window.__reactProfile.length,
        fiberStart: state.fibers.length,
      };
      state.phases.push(phase);
      state.currentPhase = name;
      return phase.start;
    },
    finish(name) {
      flushTasks();
      let phase = null;
      for (let index = state.phases.length - 1; index >= 0; index--) {
        if (state.phases[index].name === name && state.phases[index].end === null) {
          phase = state.phases[index];
          break;
        }
      }
      if (!phase) throw new Error("No open profiling phase: " + name);
      phase.end = performance.now();
      phase.profilerEnd = window.__reactProfile.length;
      phase.fiberEnd = state.fibers.length;
      state.currentPhase = "between-phases";
      return { ...phase, fibers: state.fibers.slice(phase.fiberStart, phase.fiberEnd) };
    },
    errors() { return [...state.observerErrors]; },
    observerSupported: () => state.observerSupported,
    longTasks() { flushTasks(); return [...state.longTasks]; },
    phases() { return state.phases.map((phase) => ({ ...phase })); },
  };
})();
`;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const range = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? {
        median: median(finite),
        min: Math.min(...finite),
        max: Math.max(...finite),
        available: true,
      }
    : { median: null, min: null, max: null, available: false };
};

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function getTrackerErrors(page) {
  return page.evaluate(() => window.__reactFullProfileApi.errors());
}

function aggregateComponents(commits) {
  const components = {};
  for (const commit of commits) {
    for (const [name, sample] of Object.entries(commit.components)) {
      const item = (components[name] ||= {
        performedWork: 0,
        selfDurationMs: 0,
        timingAvailable: true,
        propComparisons: {
          props_changed: 0,
          props_unchanged: 0,
          initial_mount: 0,
        },
        changedPropNames: {},
      });
      item.performedWork += sample.performedWork;
      item.timingAvailable &&= sample.timingAvailable;
      if (sample.selfDurationMs !== null)
        item.selfDurationMs += sample.selfDurationMs;
      for (const [category, count] of Object.entries(sample.propComparisons))
        item.propComparisons[category] += count;
      for (const [prop, count] of Object.entries(sample.changedPropNames)) {
        item.changedPropNames[prop] =
          (item.changedPropNames[prop] || 0) + count;
      }
    }
  }
  for (const item of Object.values(components)) {
    item.selfDurationMs = item.timingAvailable
      ? Number(item.selfDurationMs.toFixed(4))
      : null;
  }
  return components;
}

function phaseMetrics(name, phase, profilerSamples, fibers, allLongTasks) {
  const appSamples = profilerSamples
    .slice(phase.profilerStart, phase.profilerEnd)
    .filter((sample) => sample.id === "app");
  const durations = appSamples
    .map((sample) => sample.actualDuration)
    .filter(Number.isFinite);
  const appDurationUnavailable =
    appSamples.length > 0 && durations.length !== appSamples.length;
  const longTasks = allLongTasks.filter(
    (task) => task.startTime >= phase.start && task.startTime < phase.end,
  );
  const components = aggregateComponents(fibers);
  const measuredFibers = fibers.filter((commit) => commit.fiberTimingAvailable);
  const fiberTimingAvailable =
    fibers.length > 0 && measuredFibers.length === fibers.length;
  const fiberTimingUnavailableReasons = {};
  for (const commit of fibers) {
    if (commit.timingUnavailableReason) {
      fiberTimingUnavailableReasons[commit.timingUnavailableReason] =
        (fiberTimingUnavailableReasons[commit.timingUnavailableReason] || 0) +
        1;
    }
  }
  return {
    name,
    wallMs: Number((phase.end - phase.start).toFixed(3)),
    completedSteps: phase.completedSteps,
    expectedSteps: phase.expectedSteps,
    appProfiler: {
      commits: appSamples.length,
      actualDurationMs: !appDurationUnavailable
        ? Number(durations.reduce((sum, value) => sum + value, 0).toFixed(4))
        : null,
      timingAvailable: !appDurationUnavailable,
      timingUnavailableReason: !appDurationUnavailable
        ? null
        : "One or more app Profiler actualDuration samples were non-finite.",
    },
    fiber: {
      commits: measuredFibers.length,
      observedRootCommits: fibers.length,
      timingAvailable: fiberTimingAvailable,
      timingUnavailableReasons: fiberTimingUnavailableReasons,
      rootActualDurationMs: (() => {
        if (!fiberTimingAvailable) return null;
        const values = measuredFibers
          .map((item) => item.rootActualDurationMs)
          .filter(Number.isFinite);
        return values.length
          ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(4))
          : null;
      })(),
      components,
    },
    longTasks: {
      count: longTasks.length,
      totalMs: Number(
        longTasks.reduce((sum, task) => sum + task.duration, 0).toFixed(3),
      ),
      maxMs: longTasks.length
        ? Number(Math.max(...longTasks.map((task) => task.duration)).toFixed(3))
        : 0,
    },
  };
}

async function measurePhase(page, expect, name, steps, action) {
  await settle(page);
  await page.evaluate(
    (label) => window.__reactFullProfileApi.begin(label),
    name,
  );
  const started = Date.now();
  for (let step = 0; step < steps; step++) {
    await action(step);
    await settle(page);
    const errors = await getTrackerErrors(page);
    if (errors.length)
      throw new Error(
        `Profiler observer failed during ${name}: ${errors.join("\n")}`,
      );
  }
  const wallMs = Date.now() - started;
  const collected = await page.evaluate(
    (label) => window.__reactFullProfileApi.finish(label),
    name,
  );
  collected.expectedSteps = steps;
  collected.completedSteps = steps;
  const profilerSamples = await page.evaluate(() => window.__reactProfile);
  const fiberAll = await page.evaluate(
    () => window.__reactFullProfileState.fibers,
  );
  const longTasks = await page.evaluate(() =>
    window.__reactFullProfileApi.longTasks(),
  );
  const result = phaseMetrics(
    name,
    collected,
    profilerSamples,
    fiberAll.slice(collected.fiberStart || 0, collected.fiberEnd),
    longTasks,
  );
  result.wallMs = wallMs;
  expect(result.completedSteps).toBe(steps);
  expect(await getTrackerErrors(page)).toEqual([]);
  return result;
}

async function runVersion(browser, label, round, options) {
  const { installTauriStub, pushEvent } = options.stub;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    baseURL: `http://127.0.0.1:${options.ports[label]}`,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.addInitScript(PROFILE_INIT);
    await installTauriStub(page);
    const startupStarted = Date.now();
    await page.goto("/");
    await options.expect(page.locator("main.dashboard")).toBeVisible();
    await options.expect(page.locator(".topbar")).toBeVisible();
    await options
      .expect(page.locator(".chart-frame canvas").first())
      .toBeVisible({ timeout: 20_000 });
    await options.expect
      .poll(() =>
        page.evaluate(() =>
          window.__E2E_TAURI_STUB__?.listenerCount("quote-update"),
        ),
      )
      .toBe(1);
    await options.expect
      .poll(() =>
        page.evaluate(() =>
          window.__E2E_TAURI_STUB__?.listenerCount("market-snapshot"),
        ),
      )
      .toBe(1);
    await settle(page);
    const startupWallMs = Date.now() - startupStarted;
    const navigation = await page.evaluate(() => {
      const timing = performance.getEntriesByType("navigation")[0];
      const paint = performance.getEntriesByName("first-contentful-paint")[0];
      return {
        firstContentfulPaintMs: paint?.startTime ?? null,
        domContentLoadedMs: timing?.domContentLoadedEventEnd ?? null,
      };
    });
    if (
      !Number.isFinite(navigation.firstContentfulPaintMs) ||
      !Number.isFinite(navigation.domContentLoadedMs)
    ) {
      throw new Error("Startup navigation/FCP timing was unavailable.");
    }
    if (
      !(await page.evaluate(() =>
        window.__reactFullProfileApi.observerSupported(),
      ))
    ) {
      throw new Error(
        "PerformanceObserver longtask instrumentation was unavailable.",
      );
    }
    const startupPhase = await page.evaluate(() =>
      window.__reactFullProfileApi.finish("startup"),
    );
    startupPhase.expectedSteps = 1;
    startupPhase.completedSteps = 1;
    const snapshot = await page.evaluate(async () =>
      window.__TAURI_INTERNALS__.invoke("get_market_snapshot"),
    );
    const seedQuote = await page.evaluate(async () =>
      window.__TAURI_INTERNALS__.invoke("get_quote_snapshot"),
    );
    if (!snapshot?.candles?.length || !seedQuote?.symbol)
      throw new Error("Stub startup fixtures were unavailable.");
    const profilerSamples = await page.evaluate(() => window.__reactProfile);
    const fiberAll = await page.evaluate(
      () => window.__reactFullProfileState.fibers,
    );
    const startupLongTasks = await page.evaluate(() =>
      window.__reactFullProfileApi.longTasks(),
    );
    const startupFibers = fiberAll.slice(
      startupPhase.fiberStart || 0,
      startupPhase.fiberEnd,
    );
    const phases = {
      startup: phaseMetrics(
        "startup",
        startupPhase,
        profilerSamples,
        startupFibers,
        startupLongTasks,
      ),
    };
    phases.startup.wallMs = startupWallMs;
    phases.startup.startup = {
      wallMs: startupWallMs,
      firstContentfulPaintMs: Number(
        navigation.firstContentfulPaintMs.toFixed(3),
      ),
      domContentLoadedMs: Number(navigation.domContentLoadedMs.toFixed(3)),
    };
    const initialAppCommits = profilerSamples
      .slice(startupPhase.profilerStart, startupPhase.profilerEnd)
      .filter((item) => item.id === "app");
    if (!initialAppCommits.length)
      throw new Error("React Profiler recorded no startup app commits.");
    if (!initialAppCommits.some((item) => Number.isFinite(item.actualDuration)))
      throw new Error(
        "React Profiler provided no finite startup app duration sample.",
      );

    phases.idle = await measurePhase(
      page,
      options.expect,
      "idle",
      1,
      async () => page.waitForTimeout(800),
    );
    let currentQuote = seedQuote;
    phases.quoteTimeOnly = await measurePhase(
      page,
      options.expect,
      "quoteTimeOnly",
      40,
      async () => {
        const timeMs = currentQuote.timeMs + 100;
        await pushEvent(page, "quote-update", {
          ...currentQuote,
          timeMs,
        });
        currentQuote = { ...currentQuote, timeMs };
      },
    );
    phases.quotePriceChanging = await measurePhase(
      page,
      options.expect,
      "quotePriceChanging",
      40,
      async () => {
        const delta = 0.00001;
        const timeMs = currentQuote.timeMs + 100;
        const bid = (Number(currentQuote.bid) + delta).toFixed(5);
        const ask = (Number(currentQuote.ask) + delta).toFixed(5);
        const last = (Number(currentQuote.last) + delta).toFixed(5);
        await pushEvent(page, "quote-update", {
          ...currentQuote,
          timeMs,
          bid,
          ask,
          last,
        });
        currentQuote = { ...currentQuote, timeMs, bid, ask, last };
      },
    );
    const baseCandle = snapshot.candles[snapshot.candles.length - 1];
    phases.liveCandle = await measurePhase(
      page,
      options.expect,
      "liveCandle",
      20,
      async (index) => {
        const open = Number(baseCandle.open);
        const close = open + (index + 1) * 0.00001;
        await pushEvent(page, "bar-update", {
          symbol: snapshot.symbol,
          timeframe: snapshot.timeframe,
          candle: {
            ...baseCandle,
            open: open.toFixed(4),
            high: (Math.max(open, close) + 0.0005).toFixed(4),
            low: (Math.min(open, close) - 0.0005).toFixed(4),
            close: close.toFixed(4),
            tickVolume: baseCandle.tickVolume + index + 1,
            realVolume: baseCandle.realVolume + index + 1,
          },
        });
      },
    );

    phases.panelToggles = await measurePhase(
      page,
      options.expect,
      "panelToggles",
      8,
      async () => {
        await page.getByRole("button", { name: "Toggle trade panel" }).click();
      },
    );
    phases.settingsEdits = await measurePhase(
      page,
      options.expect,
      "settingsEdits",
      10,
      async (index) => {
        const button = page.getByRole("button", { name: "App settings" });
        if (index === 0) {
          await button.click();
          const dialog = page.getByRole("dialog", { name: "App settings" });
          await options.expect(dialog).toBeVisible();
        }
        await page
          .getByRole("textbox", { name: "Address" })
          .fill(`127.0.0.1:${8766 + (index % 2)}`);
      },
    );
    await page.keyboard.press("Escape");
    await options
      .expect(page.getByRole("dialog", { name: "App settings" }))
      .toHaveCount(0);
    phases.toolsCrosshair = await measurePhase(
      page,
      options.expect,
      "toolsCrosshair",
      1,
      async () => {
        await page
          .getByRole("button", { name: "Pointer tools", exact: true })
          .click();
        const menu = page.getByRole("menu", { name: "Pointer tools" });
        await options.expect(menu).toBeVisible();
        await menu
          .getByRole("menuitemradio", { name: "Crosshair pointer" })
          .click();
      },
    );
    phases.ticketStage = await measurePhase(
      page,
      options.expect,
      "ticketStage",
      1,
      async () => {
        await page.getByRole("button", { name: "Toggle trade panel" }).click();
        const ticket = page.getByRole("region", {
          name: "Order ticket",
          exact: true,
        });
        await options.expect(ticket).toBeVisible();
        await ticket.locator(".ticket-quote-side.buy").click();
        await ticket
          .getByRole("button", { name: "Limit", exact: true })
          .click();
        await options
          .expect(ticket.getByLabel("Order price", { exact: true }))
          .toBeEnabled();
      },
    );
    const ticket = page.getByRole("region", {
      name: "Order ticket",
      exact: true,
    });
    const price = ticket.getByLabel("Order price", { exact: true });
    phases.ticketEntryEdits = await measurePhase(
      page,
      options.expect,
      "ticketEntryEdits",
      20,
      async (index) => {
        await price.fill((1.082 + (index % 2) * 0.0001).toFixed(4));
      },
    );
    await ticket.getByRole("button", { name: "Extra settings" }).click();
    const tif = ticket.getByRole("combobox", { name: "Time in force" });
    phases.ticketTimeInForce = await measurePhase(
      page,
      options.expect,
      "ticketTimeInForce",
      20,
      async (index) => {
        await tif.selectOption(index % 2 ? "gtc" : "day");
      },
    );
    phases.timeframeSwitches = await measurePhase(
      page,
      options.expect,
      "timeframeSwitches",
      2,
      async (index) => {
        const label = index === 0 ? "15m" : "1m";
        const button = page
          .locator(".timeframe-tabs button")
          .filter({ hasText: new RegExp(`^${label}$`) });
        await options.expect(button).toBeVisible();
        await button.click();
        await options
          .expect(button)
          .toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
      },
    );
    phases.symbolSearch = await measurePhase(
      page,
      options.expect,
      "symbolSearch",
      1,
      async () => {
        await page.getByRole("button", { name: "Search symbols" }).click();
        const search = page.getByRole("dialog", { name: "Search symbols" });
        await options.expect(search).toBeVisible();
        await search.locator("input").fill("EUR");
        await options.expect(search.locator("input")).toHaveValue("EUR");
        await page.keyboard.press("Escape");
      },
    );
    phases.reconnect = await measurePhase(
      page,
      options.expect,
      "reconnect",
      3,
      async (index) => {
        if (index === 0) {
          await pushEvent(page, "bridge-status", {
            state: "disconnected",
            message: "Profiler disconnect",
          });
        } else if (index === 1) {
          await pushEvent(page, "bridge-status", {
            state: "connected",
            message: "Profiler reconnect",
          });
        } else {
          await pushEvent(page, "market-snapshot", {
            ...snapshot,
            timeframe: "M1",
            complete: true,
          });
        }
      },
    );
    await options
      .expect(page.locator(".chart-heading h1"))
      .toHaveText(snapshot.symbol);

    const submissionCount = await page.evaluate(
      () =>
        window.__E2E_TAURI_STUB__.invocations.filter(
          (item) => item.cmd === "submit_order",
        ).length,
    );
    if (submissionCount !== 0)
      throw new Error(
        `Unexpected submit_order invocation in ${label} round ${round}: ${submissionCount}`,
      );
    const hookErrors = await getTrackerErrors(page);
    if (hookErrors.length)
      throw new Error(`Profiler observer failed: ${hookErrors.join("\n")}`);
    if (errors.length)
      throw new Error(JSON.stringify({ label, round, errors }));
    const profilerFinal = await page.evaluate(() => window.__reactProfile);
    const fiberFinal = await page.evaluate(
      () => window.__reactFullProfileState.fibers,
    );
    const taskFinal = await page.evaluate(() =>
      window.__reactFullProfileApi.longTasks(),
    );
    for (const [name, phase] of Object.entries(phases)) {
      if (phase.completedSteps !== phase.expectedSteps)
        throw new Error(`Phase ${name} did not complete all steps.`);
    }
    await options.expect
      .poll(() =>
        page.evaluate(() =>
          window.__E2E_TAURI_STUB__?.listenerCount("bridge-status"),
        ),
      )
      .toBe(1);
    return {
      label,
      round,
      errors,
      observerErrors: hookErrors,
      submissionCount,
      startup: phases.startup.startup,
      phases,
      rawReactProfilerSamples: profilerFinal,
      rawFiberCommits: fiberFinal,
      rawLongTasks: taskFinal,
    };
  } finally {
    await context.close();
  }
}

function summarizeRuns(runs, roundCount) {
  const phaseNames = Object.keys(runs[0].phases);
  const summary = { roundCount, phases: {} };
  for (const phaseName of phaseNames) {
    summary.phases[phaseName] = {};
    for (const label of ["main", "branch"]) {
      const selected = runs
        .filter((run) => run.label === label)
        .map((run) => run.phases[phaseName]);
      const components = new Set(
        selected.flatMap((phase) => Object.keys(phase.fiber.components)),
      );
      const topComponents = [...components]
        .map((name) => {
          const samples = selected.map((phase) => phase.fiber.components[name]);
          const performed = samples.map((item) => item?.performedWork ?? 0);
          const self = samples
            .filter((item) => item?.selfDurationMs !== null)
            .map((item) => item?.selfDurationMs ?? 0);
          const props = {
            props_changed: 0,
            props_unchanged: 0,
            initial_mount: 0,
          };
          for (const item of samples)
            for (const category of Object.keys(props))
              props[category] += item?.propComparisons?.[category] ?? 0;
          return {
            name,
            performedWork: range(performed),
            selfDurationMs: range(self),
            propComparisons: props,
          };
        })
        .sort((a, b) => {
          if (a.selfDurationMs.available && b.selfDurationMs.available)
            return b.selfDurationMs.median - a.selfDurationMs.median;
          return b.performedWork.median - a.performedWork.median;
        })
        .slice(0, 20);
      const appDurations = selected
        .map((phase) => phase.appProfiler.actualDurationMs)
        .filter(Number.isFinite);
      const rootCommits = selected.map((phase) => phase.appProfiler.commits);
      const unavailableFiberReasons = {};
      for (const phase of selected) {
        for (const [reason, count] of Object.entries(
          phase.fiber.timingUnavailableReasons,
        )) {
          unavailableFiberReasons[reason] =
            (unavailableFiberReasons[reason] || 0) + count;
        }
      }
      summary.phases[phaseName][label] = {
        expectedSteps: selected[0].expectedSteps,
        completedSteps: range(selected.map((phase) => phase.completedSteps)),
        wallMs: range(selected.map((phase) => phase.wallMs)),
        appProfiler: {
          commits: range(rootCommits),
          totalActualDurationMs: range(appDurations),
          timingAvailable: appDurations.length > 0,
        },
        fiberCommitCount: range(selected.map((phase) => phase.fiber.commits)),
        observedFiberRootCommitCount: range(
          selected.map((phase) => phase.fiber.observedRootCommits),
        ),
        fiberTimingAvailableRuns: selected.filter(
          (phase) => phase.fiber.timingAvailable,
        ).length,
        unavailableFiberReasons,
        longTasks: {
          count: range(selected.map((phase) => phase.longTasks.count)),
          totalMs: range(selected.map((phase) => phase.longTasks.totalMs)),
        },
        startup:
          phaseName === "startup"
            ? {
                wallMs: range(selected.map((phase) => phase.startup.wallMs)),
                firstContentfulPaintMs: range(
                  selected.map((phase) => phase.startup.firstContentfulPaintMs),
                ),
              }
            : undefined,
        topComponents,
      };
    }
  }
  return summary;
}

async function collectFull(browser, options) {
  const { output, ports, roundCount, stub, expect } = options;
  if (
    !browser ||
    !output ||
    !ports?.main ||
    !ports?.branch ||
    !roundCount ||
    !stub ||
    !expect
  ) {
    throw new Error(
      "collectFull requires browser, output, both ports, roundCount, stub, and expect.",
    );
  }
  fs.mkdirSync(output, { recursive: true });
  const runs = [];
  for (let round = 0; round < roundCount; round++) {
    for (const label of round % 2 ? ["branch", "main"] : ["main", "branch"]) {
      const run = await runVersion(browser, label, round, options);
      runs.push(run);
      fs.writeFileSync(
        path.join(output, "full-raw.json"),
        JSON.stringify({ roundCount, runs }, null, 2),
      );
      console.log(
        `Full React profile completed ${label}, round ${round + 1}/${roundCount}.`,
      );
    }
  }
  const result = { roundCount, summary: summarizeRuns(runs, roundCount) };
  fs.writeFileSync(
    path.join(output, "full-summary.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}

module.exports = { collectFull };
