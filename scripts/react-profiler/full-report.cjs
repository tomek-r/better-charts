const { escapeHtml } = require("./shared.cjs");

const escape = (value) => escapeHtml(value ?? "—");

const phaseNames = {
  startup: "Startup",
  idle: "Idle",
  quoteTimeOnly: "Quote updates · time only",
  quotePriceChanging: "Quote updates · prices changing",
  liveCandle: "Live candles",
  panelFirstOpen: "Trade panel first open and close",
  panelToggles: "Trade panel toggles",
  settingsEdits: "Settings edits",
  toolsCrosshair: "Crosshair tool",
  ticketStage: "Buy Limit staging",
  ticketEntryEdits: "Order price edits",
  ticketTimeInForce: "GTC / Day changes",
  timeframeSwitches: "Timeframe switches",
  symbolSearch: "Symbol search",
  reconnect: "Reconnect",
};

function formatRange(value, unit = "", digits = 1) {
  if (!value?.available || !Number.isFinite(value.median)) {
    return '<span class="unavailable">Unavailable</span>';
  }
  const format = (number) => `${number.toFixed(digits)}${unit}`;
  return `<strong>${format(value.median)}</strong><span class="range">${format(value.min)}–${format(value.max)}</span>`;
}

function formatCount(value) {
  return formatRange(value, "", 0);
}

function delta(baseline, candidate) {
  if (!baseline?.available || !candidate?.available) return "Unavailable";
  if (baseline.median === 0) {
    const slower = candidate.min > baseline.max;
    return `${candidate.median === 0 ? "0.0%" : "n/a (baseline is 0)"}${slower ? ' <span class="flag">Candidate slower; ranges do not overlap</span>' : ""}`;
  }
  const percent = (candidate.median / baseline.median - 1) * 100;
  const separatedSlower = percent > 0 && candidate.min > baseline.max;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%${separatedSlower ? ' <span class="flag">Candidate slower; ranges do not overlap</span>' : ""}`;
}

function rangeCell(value, unit = "", digits = 1) {
  return `<td>${formatRange(value, unit, digits)}</td>`;
}

function fiberCoverage(row) {
  const measured = row.fiberCommitCount;
  const observed = row.observedFiberRootCommitCount;
  if (!measured?.available || !observed?.available) {
    return '<td><span class="unavailable">Unavailable</span></td>';
  }
  return `<td><strong>${measured.median.toFixed(0)} / ${observed.median.toFixed(0)}</strong><span class="range">Measured / observed root commits · timing available in ${escape(row.fiberTimingAvailableRuns)} runs</span></td>`;
}

function longTaskCell(row) {
  return `<td>${formatCount(row.longTasks.count)}<span class="range">Total ${formatRange(row.longTasks.totalMs, " ms")}</span></td>`;
}

function durationCell(value, color, maximum) {
  const width =
    value?.available && maximum > 0
      ? Math.max(0, Math.min(100, (100 * value.median) / maximum))
      : 0;
  return `<td>${formatRange(value, " ms")}<span class="bar ${color}" aria-hidden="true" style="width:${width.toFixed(1)}%"></span></td>`;
}

function metadataRows(metadata) {
  const rows = {
    Captured: metadata.capturedAt,
    Baseline: metadata.baselineCommit
      ? `${metadata.baselineRef ?? "main"} · ${metadata.baselineCommit}`
      : metadata.baselineRef,
    Candidate: `${metadata.candidateBranch ?? "working tree"}${metadata.candidateDirty ? " · uncommitted changes" : ""}`,
    "Candidate HEAD": metadata.candidateHead,
    "Source hashes": metadata.sourceHashes
      ? Object.entries(metadata.sourceHashes)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" · ")
      : undefined,
    React: metadata.react,
    Mode: metadata.mode,
    "React Compiler":
      metadata.reactCompiler === undefined
        ? undefined
        : metadata.reactCompiler
          ? "enabled"
          : "disabled",
    Runs:
      metadata.roundCount === undefined
        ? undefined
        : `${metadata.roundCount} alternating rounds per snapshot`,
    Browser: metadata.browser,
    Viewport: metadata.viewport
      ? `${metadata.viewport.width} × ${metadata.viewport.height}`
      : undefined,
  };
  return Object.entries(rows)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`)
    .join("");
}

function componentRows(phases) {
  return phases
    .map(([phase, data]) => {
      const sources = [
        ["Baseline", data.main.topComponents ?? []],
        ["Candidate", data.branch.topComponents ?? []],
      ];
      return sources
        .map(([source, components]) =>
          components
            .map((item) => {
              const counts = item.propComparisons;
              const props = counts
                ? `changed ${counts.props_changed ?? 0} · unchanged ${counts.props_unchanged ?? 0} · mount ${counts.initial_mount ?? 0}`
                : "—";
              return `<tr data-phase="${escape(phase)}">
                <td>${escape(source)}</td><th scope="row">${escape(item.name)}</th>
                <td>${formatCount(item.performedWork)}</td><td>${formatRange(item.selfDurationMs, " ms")}</td><td>${escape(props)}</td>
              </tr>`;
            })
            .join(""),
        )
        .join("");
    })
    .join("");
}

function renderFullReport(result, metadata = {}) {
  const summary = result?.summary ?? result;
  const phases = Object.entries(summary?.phases ?? {});
  if (!phases.length)
    throw new Error("Full React profile summary has no phases.");
  const baseline = metadata.baselineRef ?? "main";
  const candidate = metadata.candidateBranch ?? "working tree";
  const phaseOptions = phases
    .map(
      ([phase]) =>
        `<option value="${escape(phase)}">${escape(phaseNames[phase] ?? phase)}</option>`,
    )
    .join("");
  const phaseRows = phases
    .map(([phase, pair]) => {
      const a = pair.main;
      const b = pair.branch;
      const aDuration = a.appProfiler.totalActualDurationMs;
      const bDuration = b.appProfiler.totalActualDurationMs;
      const maxDuration = Math.max(
        aDuration.median ?? 0,
        bDuration.median ?? 0,
      );
      const steps = (row) =>
        row.completedSteps?.available
          ? `${row.completedSteps.median.toFixed(0)}/${escape(row.expectedSteps)} (${row.completedSteps.min.toFixed(0)}–${row.completedSteps.max.toFixed(0)} completed)`
          : `Unavailable/${escape(row.expectedSteps)}`;
      const aSteps = steps(a);
      const bSteps = steps(b);
      const fcp =
        phase === "startup"
          ? `<tr><th scope="row">First contentful paint</th>${rangeCell(a.startup.firstContentfulPaintMs, " ms")}${rangeCell(b.startup.firstContentfulPaintMs, " ms")}<td colspan="9">Navigation paint timing, not React render time.</td></tr>`
          : "";
      return `<tr>
        <th scope="row">${escape(phaseNames[phase] ?? phase)}<span class="range">Steps ${aSteps} / ${bSteps}</span></th>
        ${durationCell(aDuration, "base", maxDuration)}${durationCell(bDuration, "branch", maxDuration)}
        <td>${delta(aDuration, bDuration)}</td>
        ${rangeCell(a.appProfiler.commits, "", 0)}${rangeCell(b.appProfiler.commits, "", 0)}
        ${fiberCoverage(a)}${fiberCoverage(b)}
        ${longTaskCell(a)}${longTaskCell(b)}
        ${rangeCell(a.wallMs, " ms")}${rangeCell(b.wallMs, " ms")}
      </tr>${fcp}`;
    })
    .join("");
  const titleMain = escape(baseline);
  const titleCandidate = escape(candidate);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Full-app React profile comparison</title>
<style>
:root{color-scheme:light;--ink:#17263b;--muted:#526176;--line:#dbe2ed;--base:#536ba2;--branch:#087f80;--warn:#945400}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:var(--ink);font:15px/1.55 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:40px 22px 64px}header{max-width:900px;margin-bottom:24px}.eyebrow{color:var(--branch);font-size:12px;letter-spacing:.12em;font-weight:700;text-transform:uppercase}h1{font-size:clamp(28px,5vw,42px);line-height:1.15;margin:10px 0 14px}h2{font-size:23px;margin:32px 0 12px}p{margin:8px 0}.muted,.range,caption{color:var(--muted)}.notice,.card,.table-scroll{background:white;border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:14px}.notice{border-left:4px solid var(--branch);background:#eaf4f3}.table-scroll{overflow-x:auto;padding:16px}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px;font-variant-numeric:tabular-nums}caption{text-align:left;padding:0 0 12px;font-size:13px}th,td{padding:10px 9px;border-bottom:1px solid var(--line);vertical-align:top}thead th{font-size:12px;color:var(--muted)}tbody th{font-weight:600;min-width:150px}tbody tr:last-child>*{border-bottom:0}.range{display:block;font-size:11px;margin-top:3px}.unavailable{color:var(--muted);font-style:italic}.flag{display:block;color:var(--warn);font-size:11px;font-weight:600;margin-top:3px}.bar{display:block;height:5px;margin-top:7px;border-radius:3px;max-width:100%}.base{background:var(--base)}.branch{background:var(--branch)}dl{display:grid;grid-template-columns:160px 1fr;gap:7px 16px;margin:0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.controls{display:flex;align-items:center;gap:10px;margin:10px 0 14px}select{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:white}details{margin-top:16px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}footer{margin-top:28px;font-size:12px;color:var(--muted)}@media(max-width:700px){main{padding:25px 10px}.notice,.card,.table-scroll{padding:12px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:8px}}
</style></head><body><main>
<header><div class="eyebrow">React Profiler · Full app</div><h1>Full-app React profile comparison</h1><p>${titleMain} → ${titleCandidate}</p><p class="muted">${escape(summary.roundCount)} alternating rounds per snapshot · ${escape(metadata.mode ?? "production")} React profiling build · browser Tauri stub</p></header>
<section class="notice" aria-label="Measurement note"><strong>Use the timings as a relative comparison between these snapshots.</strong><p>The profiling build includes React Profiler overhead. It does not measure native Tauri or MT5 work, dispatch behavior, browser paint latency, or real trading conditions. No order submission is part of this capture.</p></section>
<section aria-labelledby="phases-title"><h2 id="phases-title">Phase comparison</h2><p class="muted">Render time is app Profiler actualDuration. Cells show median and minimum–maximum across runs. Bars compare the two medians within each phase. A slower candidate is flagged only when its full range exceeds the baseline range.</p><div class="table-scroll"><table><caption>Full-app phases; “steps” shows completed interactions against the expected count.</caption><thead><tr><th scope="col">Phase</th><th scope="col">${titleMain} render time</th><th scope="col">${titleCandidate} render time</th><th scope="col">Median change</th><th scope="col">${titleMain} app commits</th><th scope="col">${titleCandidate} app commits</th><th scope="col">${titleMain} Fiber commits</th><th scope="col">${titleCandidate} Fiber commits</th><th scope="col">${titleMain} long tasks</th><th scope="col">${titleCandidate} long tasks</th><th scope="col">${titleMain} wall time</th><th scope="col">${titleCandidate} wall time</th></tr></thead><tbody>${phaseRows}</tbody></table></div></section>
<section aria-labelledby="fiber-title"><h2 id="fiber-title">Component breakdown</h2><p class="muted">Each snapshot lists its own top components by self-time or work count for the selected phase. Rows are not paired by name: production minification can assign different names to corresponding components, and the same short name can identify different components across builds. Unchanged props are a shallow comparison, not evidence that a component is memoizable or that props caused its render.</p><div class="controls"><label for="phase-filter">Show phase</label><select id="phase-filter">${phaseOptions}</select><span id="component-count" aria-live="polite"></span></div><div class="table-scroll"><table><caption>Fiber metrics are private React implementation details. Self-time is an estimate: current-window child durations are subtracted from inclusive durations. Each source's top-component list is shown independently.</caption><thead><tr><th scope="col">Snapshot</th><th scope="col">Component name</th><th scope="col">Performed work</th><th scope="col">Self-time</th><th scope="col">Prop comparison counts</th></tr></thead><tbody id="component-rows">${componentRows(phases)}</tbody></table></div><p class="muted">Unavailable private Fiber timing is shown explicitly; observed root commits and timing availability are in the summary JSON. A non-overlapping timing range is a signal for review, not a performance guarantee.</p></section>
<section aria-labelledby="method-title"><h2 id="method-title">Capture details and limits</h2><div class="card"><dl>${metadataRows(metadata)}</dl><ul><li>Each run uses a fresh browser context and deterministic Tauri stub events; ticket-probe components are excluded from this full-app suite.</li><li>Scenarios include idle, time-only and price-changing quotes, live candles, trade-panel toggles, settings edits without saving, crosshair selection, Buy Limit staging and field edits, timeframe changes, symbol search, and reconnect.</li><li>React component work is filtered to PerformedWork fibers whose private actualStartTime falls within the app Profiler render window. Self-time subtracts only children in that same window; missing private timers remain unavailable.</li><li>Long tasks are browser main-thread long-task entries scoped to each phase. FCP is a navigation timing measure, not an input-latency or paint-quality assessment.</li><li>These measurements do not establish memoization opportunities from unchanged props or predict absolute production performance.</li></ul>${Object.keys(metadata).length ? `<details><summary>Capture metadata</summary><pre>${escape(JSON.stringify(metadata, null, 2))}</pre></details>` : ""}</div></section>
<footer>Generated by scripts/react-profiler/full-report.cjs. This report is self-contained and uses no external assets or services.</footer>
</main><script>
const filter=document.getElementById('phase-filter');const rows=[...document.querySelectorAll('#component-rows tr')];const count=document.getElementById('component-count');function update(){let visible=0;for(const row of rows){const show=row.dataset.phase===filter.value;row.hidden=!show;if(show)visible++;}count.textContent=visible+' component rows';}filter.addEventListener('change',update);update();
</script></body></html>\n`;
}

module.exports = { renderFullReport };
