const fs = require("node:fs");
const path = require("node:path");

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
const ms = (value) => value.toFixed(1);
const scenarioNames = {
  quotes: "Live quotes",
  entry: "Entry price edits",
  settings: "Extra settings",
};
const consumers = [
  "quotes",
  "pricing",
  "sizing",
  "exits",
  "settings",
  "action",
];

function renderReport(result, metadata = {}) {
  const { operations, roundCount, summary } = result;
  const baseline = metadata.baselineRef ?? "main";
  const candidate = metadata.candidateBranch ?? "working tree";
  const scenarios = Object.entries(summary);
  const timingTable = (id) => `<div class="table-scroll"><table>
    <caption>${id === "app" ? "Whole app" : "Ticket scope"} — total React actualDuration per ${escape(operations)} interactions</caption>
    <thead><tr><th scope="col">Scenario</th><th scope="col">Baseline median / range</th><th scope="col">Candidate median / range</th><th scope="col">Median change</th></tr></thead>
    <tbody>${scenarios
      .map(([name, versions]) => {
        const a = versions.main[id];
        const b = versions.branch[id];
        const change = a.medianTotalActualMs
          ? (b.medianTotalActualMs / a.medianTotalActualMs - 1) * 100
          : null;
        const cell = (row) =>
          `<strong>${ms(row.medianTotalActualMs)} ms</strong><span class="range">${ms(row.minTotalActualMs)}–${ms(row.maxTotalActualMs)} ms</span>`;
        return `<tr><th scope="row">${escape(scenarioNames[name] ?? name)}</th><td>${cell(a)}</td><td>${cell(b)}</td><td>${change === null ? "n/a" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
  const consumerTables = scenarios
    .map(([name, versions]) => {
      const max = Math.max(
        1,
        ...consumers.flatMap((id) => [
          versions.main[`${id}-consumer`].medianCommits,
          versions.branch[`${id}-consumer`].medianCommits,
        ]),
      );
      return `<article class="card"><h3>${escape(scenarioNames[name] ?? name)}</h3><table><caption>Median consumer commits per ${escape(operations)} interactions</caption><thead><tr><th scope="col">Consumer</th><th scope="col">Baseline</th><th scope="col">Candidate</th></tr></thead><tbody>${consumers
        .map((id) => {
          const a = versions.main[`${id}-consumer`];
          const b = versions.branch[`${id}-consumer`];
          const cell = (row, label) =>
            `<td><strong>${escape(row.medianCommits)}</strong><span aria-hidden="true" class="bar ${label}" style="width:${(100 * row.medianCommits) / max}%"></span><span class="range">Runs: ${row.commits.map(escape).join(", ")}</span></td>`;
          return `<tr><th scope="row">${escape(id)}</th>${cell(a, "baseline")}${cell(b, "candidate")}</tr>`;
        })
        .join("")}</tbody></table></article>`;
    })
    .join("");
  const metaRows = Object.entries({
    Captured: metadata.capturedAt ?? "Not recorded",
    Baseline: metadata.baselineCommit
      ? `${baseline} · ${metadata.baselineCommit}`
      : baseline,
    Candidate: `${candidate}${metadata.candidateDirty ? " · uncommitted changes" : ""}`,
    ...(metadata.candidateHead
      ? { "Candidate HEAD": metadata.candidateHead }
      : {}),
    Runs: `${roundCount} per snapshot, alternating order`,
    Interactions: `${operations} measured per scenario, ${metadata.warmupOperations ?? 4} warm-ups`,
    Environment: `${metadata.mode ?? "development"} · React Compiler · StrictMode`,
    ...(metadata.react ? { React: metadata.react } : {}),
    ...(metadata.node ? { Node: metadata.node } : {}),
    ...(metadata.playwright ? { Playwright: metadata.playwright } : {}),
    Browser: metadata.browser ?? "Playwright Chromium",
    Viewport: `${metadata.viewport?.width ?? 1440} × ${metadata.viewport?.height ?? 1000}`,
  })
    .map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Order-ticket React profile comparison</title>
<style>
:root{color-scheme:light;--ink:#17263b;--muted:#526176;--line:#dbe2ed;--baseline:#536ba2;--candidate:#087f80}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:var(--ink);font:16px/1.6 system-ui,sans-serif}main{max-width:1160px;margin:0 auto;padding:48px 24px 64px}header{max-width:850px;margin-bottom:32px}.eyebrow{color:var(--candidate);font-size:13px;letter-spacing:.12em;font-weight:700;text-transform:uppercase}h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:12px 0 20px}h2{font-size:24px;margin:32px 0 16px}h3{margin:0 0 14px;font-size:20px}p{margin:10px 0}.muted,.range,caption{color:var(--muted)}.notice{padding:16px 20px;border-left:4px solid var(--candidate);background:#e7f3f3;border-radius:4px}.card,.table-scroll{background:white;border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}.table-scroll{overflow-x:auto}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;font-variant-numeric:tabular-nums}caption{text-align:left;padding:0 0 16px;font-size:13px}th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}thead th{font-size:12px;color:var(--muted)}tbody th{font-weight:500}tbody tr:last-child>*{border-bottom:0}.range{display:block;font-size:12px;margin-top:4px}.bar{display:block;height:5px;margin-top:6px;border-radius:3px;max-width:100%}.baseline{background:var(--baseline)}.candidate{background:var(--candidate)}dl{display:grid;grid-template-columns:150px 1fr;gap:10px 20px;margin:0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}details{margin-top:20px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}li{margin:8px 0}footer{margin-top:32px;font-size:13px;color:var(--muted)}@media(max-width:950px){.grid{grid-template-columns:1fr}}@media(max-width:550px){main{padding:28px 12px}.card,.table-scroll{padding:12px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:12px}}@media print{body{background:white}main{padding:0}.grid{display:block}.card{break-inside:avoid}details{display:none}}
</style></head><body><main>
<header><div class="eyebrow">React Profiler · Local comparison</div><h1>Order-ticket editor</h1><p>${escape(baseline)} → ${escape(candidate)}</p><p class="muted">${escape(roundCount)} rounds per snapshot · ${escape(operations)} measured interactions per scenario · browser Tauri stub</p></header>
<div class="notice"><strong>Interpret timings as a local development comparison.</strong><p>Consumer counts show which subscriptions commit. Render timings include instrumentation and lifecycle work; overlapping ranges do not establish a production speed improvement.</p></div>
<section aria-labelledby="timings"><h2 id="timings">React rendering time</h2><p class="muted">Median total across runs, with minimum–maximum ranges. Lower is faster. These are React render durations, not wall time or browser paint latency.</p>${timingTable("app")}${timingTable("ticket-scope")}</section>
<section aria-labelledby="consumers"><h2 id="consumers">Context consumer commits</h2><p class="muted">Baseline bars are blue; candidate bars are teal. Counts measure the instrumented context consumers, rather than DOM paints.</p><div class="grid">${consumerTables}</div></section>
<section aria-labelledby="method"><h2 id="method">Method and scope</h2><div class="card"><dl>${metaRows}</dl><ul><li>Fresh browser context for each run; two animation frames settle after each interaction.</li><li>Scenarios: quotes with an unstaged ticket, staged Buy Limit entry price edits, and GTC/Day time-in-force toggles.</li><li>Identical probes subscribe to the aggregate baseline context and focused candidate contexts. Whole-app timings include probe work.</li><li>The nested ticket-view profiler reports no updates through these memoized ancestor paths. Its zero rows are excluded from conclusions.</li><li>No native Tauri or MT5 runtime, production build, browser paint, or input-latency measurement. No orders are submitted.</li></ul>${Object.keys(metadata).length ? `<details><summary>Capture metadata</summary><pre>${escape(JSON.stringify(metadata, null, 2))}</pre></details>` : ""}</div></section>
<footer>Generated by scripts/react-profiler/report.cjs. This file is self-contained and uses no external assets or services.</footer>
</main></body></html>\n`;
}

if (require.main === module) {
  const [summaryFile, outputFile, metadataFile] = process.argv.slice(2);
  if (!summaryFile) {
    console.error(
      "Usage: node scripts/react-profiler/report.cjs summary.json [report.html] [metadata.json]",
    );
    process.exitCode = 1;
  } else {
    const result = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
    const metadata = metadataFile
      ? JSON.parse(fs.readFileSync(metadataFile, "utf8"))
      : {};
    const target =
      outputFile ?? path.join(path.dirname(summaryFile), "report.html");
    fs.writeFileSync(target, renderReport(result, metadata));
    console.log(`Saved ${target}`);
  }
}

module.exports = { renderReport };
