const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { git, prepareSnapshots } = require("./snapshot.cjs");
const { loadTools, collect } = require("./measure.cjs");
const { renderReport } = require("./report.cjs");

function integer(name, fallback, max) {
  const text = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}.`);
  }
  return Number(text);
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is unavailable. Set PROFILE_PORT_BASE to two free consecutive ports.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function waitForServer(server, port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error(
        `Profiling server on port ${port} exited; inspect its output log.`,
      );
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // Vite may still be starting or optimizing dependencies.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Profiling server on port ${port} did not become ready within 30 seconds.`,
  );
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => server.kill("SIGKILL"), 2000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function main() {
  const repo = path.resolve(__dirname, "../..");
  const baselineRef = process.env.PROFILE_BASE_REF ?? "main";
  const mode = process.env.PROFILE_MODE ?? "development";
  if (!["development", "production"].includes(mode))
    throw new Error(
      "PROFILE_MODE must be development or production (profiling build).",
    );
  const suite = process.env.PROFILE_SUITE ?? "both";
  if (!["ticket", "full", "both"].includes(suite))
    throw new Error("PROFILE_SUITE must be ticket, full, or both.");
  const roundCount = integer("PROFILE_ROUNDS", 5, 50);
  const operations = integer("PROFILE_OPERATIONS", 40, 1000);
  const portBase = integer("PROFILE_PORT_BASE", 1431, 65534);
  if (portBase < 1024)
    throw new Error("PROFILE_PORT_BASE must be at least 1024.");
  const ports = { main: portBase, branch: portBase + 1 };
  await checkPort(ports.main);
  await checkPort(ports.branch);
  const output = path.join(
    repo,
    "apps/desktop/.react-profiler",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  fs.mkdirSync(output, { recursive: true });
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "better-charts-profile-"),
  );
  const servers = [];
  let browser;
  let cleanupPromise;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      const results = await Promise.allSettled([
        ...servers.map(stopServer),
        ...(browser ? [browser.close()] : []),
      ]);
      fs.rmSync(tempRoot, { recursive: true, force: true });
      for (const result of results) {
        if (result.status === "rejected")
          console.error(`Cleanup: ${result.reason}`);
      }
    })();
    return cleanupPromise;
  };
  const interrupt = () => {
    void cleanup().finally(() => process.exit(130));
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const { baselineCommit, snapshots } = prepareSnapshots(
      repo,
      tempRoot,
      baselineRef,
      mode,
    );
    const candidateHead = git(repo, ["rev-parse", "HEAD"]).toString().trim();
    const candidateDirty = Boolean(git(repo, ["status", "--porcelain"]).length);
    const bundleDirectories = {
      main: `${baselineCommit.slice(0, 7)}-bundle`,
      branch: `${candidateHead.slice(0, 7)}${candidateDirty ? "-working" : ""}-bundle`,
    };
    const { req, chromium, expect, stub } = loadTools(repo);
    const viteBin = path.join(
      path.dirname(req.resolve("vite/package.json")),
      "bin/vite.js",
    );
    for (const [label, snapshot] of Object.entries(snapshots)) {
      const log = path.join(output, `${label}-vite.log`);
      if (mode === "production") {
        console.log(`Building ${label} production bundle (profiling build)…`);
        const build = spawnSync(
          process.execPath,
          [viteBin, "build", "--config", "profile.vite.config.ts"],
          {
            cwd: snapshot.desktop,
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 64 * 1024 * 1024,
          },
        );
        fs.writeFileSync(
          log,
          (build.stdout?.toString() ?? "") + (build.stderr?.toString() ?? ""),
        );
        if (build.status !== 0)
          throw new Error(`${label} vite build failed; inspect ${log}.`);
        fs.cpSync(
          path.join(snapshot.desktop, "dist"),
          path.join(output, bundleDirectories[label]),
          { recursive: true },
        );
      }
      const serverHandle = fs.openSync(log, mode === "production" ? "a" : "w");
      const server = spawn(
        process.execPath,
        [
          viteBin,
          mode === "production" ? "preview" : "dev",
          "--config",
          "profile.vite.config.ts",
          "--port",
          String(ports[label]),
        ],
        {
          cwd: snapshot.desktop,
          stdio: ["ignore", serverHandle, serverHandle],
        },
      );
      fs.closeSync(serverHandle);
      server.on("error", (error) =>
        console.error(`${label} server: ${error.message}`),
      );
      servers.push(server);
      await waitForServer(server, ports[label]);
    }
    // The runner owns signals so Playwright cannot exit before snapshot cleanup.
    browser = await chromium.launch({
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    const metadata = {
      capturedAt: new Date().toISOString(),
      baselineRef,
      baselineCommit,
      candidateBranch: git(repo, ["branch", "--show-current"])
        .toString()
        .trim(),
      candidateHead,
      candidateDirty,
      bundleDirectories: mode === "production" ? bundleDirectories : undefined,
      sourceHashes: Object.fromEntries(
        Object.entries(snapshots).map(([label, value]) => [
          label,
          value.sourceHash,
        ]),
      ),
      node: process.version,
      react: req("react/package.json").version,
      playwright: req("@playwright/test/package.json").version,
      browser: browser.version(),
      mode,
      reactCompiler: true,
      sourceMaps: mode === "production",
      componentNamesPreserved: true,
      strictMode: mode === "development",
      viewport: { width: 1440, height: 1000 },
      warmupOperations: 4,
      operations,
      roundCount,
      suite,
    };
    fs.writeFileSync(
      path.join(output, "metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
    console.log(
      `Comparing working source against ${baselineRef} (${baselineCommit.slice(0, 7)})`,
    );
    console.log(`Output: ${output}`);
    const options = {
      output,
      ports,
      operations,
      roundCount,
      baselineCommit,
      expect,
      stub,
    };
    if (suite !== "full") {
      const result = await collect(browser, options);
      fs.writeFileSync(
        path.join(output, "report.html"),
        renderReport(result, metadata),
      );
    }
    if (suite !== "ticket") {
      const { collectFull } = require("./full.cjs");
      const { renderFullReport } = require("./full-report.cjs");
      const result = await collectFull(browser, options);
      fs.writeFileSync(
        path.join(output, "full-report.html"),
        renderFullReport(result, metadata),
      );
    }
    console.log(
      `Saved ticket report, full-app captures, summaries, and metadata to ${output}`,
    );
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
