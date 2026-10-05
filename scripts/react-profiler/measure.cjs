const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

function loadTools(repo) {
  const req = createRequire(path.join(repo, "apps/desktop/package.json"));
  const { chromium, expect } = req("@playwright/test");
  const ts = req("typescript");
  const source = fs.readFileSync(
    path.join(repo, "apps/desktop/e2e/tauriStub.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const stubModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    req,
    stubModule,
    stubModule.exports,
  );
  return { req, chromium, expect, stub: stubModule.exports };
}
let expect;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function measure(page, action, operations) {
  for (let i = 0; i < 4; i++) {
    await action(i);
    await settle(page);
  }
  await page.evaluate(() => {
    window.__reactProfile = [];
  });
  const started = Date.now();
  for (let i = 0; i < operations; i++) {
    await action(i + 4);
    await settle(page);
  }
  const samples = await page.evaluate(() => window.__reactProfile);
  if (!samples?.some((sample) => sample.id === "app"))
    throw new Error("React Profiler recorded no app commits.");
  const metrics = {};
  for (const row of samples) {
    const group = (metrics[row.id] ??= {
      commits: 0,
      totalActualMs: 0,
      durations: [],
      commitTimes: [],
    });
    group.commits++;
    group.totalActualMs += row.actualDuration;
    group.durations.push(row.actualDuration);
    group.commitTimes.push(row.commitTime);
  }
  for (const group of Object.values(metrics)) {
    group.medianActualMs = median(group.durations);
    group.maxActualMs = Math.max(...group.durations);
  }
  return { wallMs: Date.now() - started, metrics, samples };
}
async function runVersion(browser, label, round, { ports, operations, stub }) {
  const { installTauriStub, pushEvent, STUB_NOW } = stub;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    baseURL: `http://127.0.0.1:${ports[label]}`,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await installTauriStub(page);
  await page.goto("/");
  await page.waitForFunction(
    () => window.__E2E_TAURI_STUB__?.listenerCount("quote-update") === 1,
  );
  await page.getByRole("button", { name: "Toggle trade panel" }).click();
  const ticket = page.getByRole("region", {
    name: "Order ticket",
    exact: true,
  });
  await expect(ticket).toBeVisible();
  await expect(ticket.locator(".ticket-quote-side.buy b")).not.toHaveText("—");
  await page.waitForTimeout(250);
  await settle(page);
  let quoteIndex = 0;
  const quote = async () => {
    const i = ++quoteIndex;
    await pushEvent(page, "quote-update", {
      symbol: "EURUSD",
      timeMs: STUB_NOW + i * 100,
      bid: (1.0846 + i * 0.00001).toFixed(5),
      ask: (1.085 + i * 0.00001).toFixed(5),
      last: (1.0846 + i * 0.00001).toFixed(5),
      volume: 10,
      volumeReal: "0",
      flags: 0,
    });
  };
  const quoteRun = await measure(page, quote, operations);
  await ticket.locator(".ticket-quote-side.buy").click();
  await ticket.getByRole("button", { name: "Limit", exact: true }).click();
  const price = ticket.getByRole("textbox", {
    name: "Order price",
    exact: true,
  });
  await expect(price).toBeEnabled();
  const editRun = await measure(
    page,
    async (i) => {
      await price.fill((1.082 + (i % 2) * 0.0001).toFixed(4));
    },
    operations,
  );
  await ticket.getByRole("button", { name: "Extra settings" }).click();
  const tif = ticket.getByRole("combobox", { name: "Time in force" });
  const settingsRun = await measure(
    page,
    async (i) => {
      await tif.selectOption(i % 2 ? "gtc" : "day");
    },
    operations,
  );
  const submissionCount = await page.evaluate(
    () =>
      window.__E2E_TAURI_STUB__.invocations.filter(
        (x) => x.cmd === "submit_order",
      ).length,
  );
  if (errors.length || submissionCount)
    throw new Error(JSON.stringify({ label, errors, submissionCount }));
  await context.close();
  return {
    label,
    round,
    errors,
    submissionCount,
    scenarios: { quotes: quoteRun, entry: editRun, settings: settingsRun },
  };
}

function summarize(runs) {
  const ids = [
    "app",
    "ticket-scope",
    "ticket-view",
    "quotes-consumer",
    "pricing-consumer",
    "sizing-consumer",
    "exits-consumer",
    "settings-consumer",
    "action-consumer",
  ];
  const summary = {};
  for (const scenario of ["quotes", "entry", "settings"]) {
    summary[scenario] = {};
    for (const label of ["main", "branch"]) {
      summary[scenario][label] = {};
      const selected = runs
        .filter((r) => r.label === label)
        .map((r) => r.scenarios[scenario]);
      for (const id of ids) {
        const values = selected.map(
          (r) => r.metrics[id] ?? { commits: 0, totalActualMs: 0 },
        );
        summary[scenario][label][id] = {
          commits: values.map((v) => v.commits),
          medianCommits: median(values.map((v) => v.commits)),
          medianTotalActualMs: median(values.map((v) => v.totalActualMs)),
          minTotalActualMs: Math.min(...values.map((v) => v.totalActualMs)),
          maxTotalActualMs: Math.max(...values.map((v) => v.totalActualMs)),
        };
      }
    }
  }
  return summary;
}

async function collect(browser, options) {
  expect = options.expect;
  const runs = [];
  for (let round = 0; round < options.roundCount; round++) {
    for (const label of round % 2 ? ["branch", "main"] : ["main", "branch"]) {
      runs.push(await runVersion(browser, label, round, options));
      fs.writeFileSync(
        path.join(options.output, "raw.json"),
        JSON.stringify(
          {
            operations: options.operations,
            roundCount: options.roundCount,
            baselineCommit: options.baselineCommit,
            runs,
          },
          null,
          2,
        ),
      );
      console.log(
        `Completed ${label} round ${round + 1}/${options.roundCount}`,
      );
    }
  }
  const result = {
    operations: options.operations,
    roundCount: options.roundCount,
    summary: summarize(runs),
  };
  fs.writeFileSync(
    path.join(options.output, "summary.json"),
    JSON.stringify(result, null, 2),
  );
  for (const [scenario, versions] of Object.entries(result.summary)) {
    console.log(
      `${scenario}: main ${versions.main.app.medianTotalActualMs.toFixed(1)} ms, branch ${versions.branch.app.medianTotalActualMs.toFixed(1)} ms (median React rendering time per ${options.operations} interactions)`,
    );
  }
  return result;
}

module.exports = { loadTools, collect };
