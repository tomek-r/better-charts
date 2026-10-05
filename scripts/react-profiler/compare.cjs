const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
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
    ".react-profiler",
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
    );
    const { req, chromium, expect, stub } = loadTools(repo);
    const viteBin = path.join(
      path.dirname(req.resolve("vite/package.json")),
      "bin/vite.js",
    );
    for (const [label, snapshot] of Object.entries(snapshots)) {
      const log = fs.openSync(path.join(output, `${label}-vite.log`), "w");
      const server = spawn(
        process.execPath,
        [
          viteBin,
          "--config",
          "profile.vite.config.ts",
          "--port",
          String(ports[label]),
        ],
        {
          cwd: snapshot.desktop,
          stdio: ["ignore", log, log],
        },
      );
      fs.closeSync(log);
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
      candidateHead: git(repo, ["rev-parse", "HEAD"]).toString().trim(),
      candidateDirty: Boolean(git(repo, ["status", "--porcelain"]).length),
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
      mode: "development",
      reactCompiler: true,
      strictMode: true,
      viewport: { width: 1440, height: 1000 },
      warmupOperations: 4,
      operations,
      roundCount,
    };
    fs.writeFileSync(
      path.join(output, "metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
    console.log(
      `Comparing working source against ${baselineRef} (${baselineCommit.slice(0, 7)})`,
    );
    console.log(`Output: ${output}`);
    const result = await collect(browser, {
      output,
      ports,
      operations,
      roundCount,
      baselineCommit,
      expect,
      stub,
    });
    fs.writeFileSync(
      path.join(output, "report.html"),
      renderReport(result, metadata),
    );
    console.log(
      `Saved report.html, raw.json, summary.json, and metadata.json to ${output}`,
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
