const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");

function git(repo, args) {
  const result = spawnSync("git", args, {
    cwd: repo,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.stderr.toString() || `git ${args[0]} failed`);
  return result.stdout;
}

function sourceHash(root) {
  const hash = createHash("sha256");
  function walk(dir) {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        hash.update(path.relative(root, file).split(path.sep).join("/"));
        hash.update(fs.readFileSync(file));
      }
    }
  }
  walk(root);
  return hash.digest("hex");
}

function instrument(desktop, repo, tempRoot) {
  const file = (name) => path.join(desktop, name);
  const version = JSON.parse(
    fs.readFileSync(file("package.json"), "utf8"),
  ).version;
  const config = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } })],
  envPrefix: ['VITE_', 'TAURI_'],
  define: { __APP_VERSION__: ${JSON.stringify(JSON.stringify(version))} },
  server: { host: '127.0.0.1', strictPort: true, fs: { allow: ${JSON.stringify([fs.realpathSync(tempRoot), repo])} } },
});
`;
  fs.writeFileSync(file("profile.vite.config.ts"), config);
  fs.writeFileSync(
    file("src/reactProfile.ts"),
    `import type { ProfilerOnRenderCallback } from 'react';
interface Sample { id: string; phase: string; actualDuration: number; baseDuration: number; startTime: number; commitTime: number }
declare global { interface Window { __reactProfile: Sample[] } }
export const recordProfile: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
  (window.__reactProfile ??= []).push({ id, phase, actualDuration, baseDuration, startTime, commitTime });
};
`,
  );
  const provider = fs.readFileSync(
    file("src/features/order-ticket/OrderTicketProvider.tsx"),
    "utf8",
  );
  const aggregate = provider.includes(
    "export function useOrderTicketEditProps(",
  );
  const hooks = {
    quotes: "useOrderTicketQuotes",
    pricing: "useOrderTicketPricing",
    sizing: "useOrderTicketSizing",
    exits: "useOrderTicketExits",
    settings: "useOrderTicketExtraSettings",
    action: "useOrderTicketAction",
  };
  const fields = {
    quotes: "side",
    pricing: "entry",
    sizing: "riskAmount",
    exits: "stopLoss",
    settings: "open",
    action: "canCheckOrder",
  };
  const groups = { quotes: "quote", settings: "extra" };
  if (!aggregate) {
    for (const hook of Object.values(hooks)) {
      if (!provider.includes(`export function ${hook}(`))
        throw new Error(`Unsupported ticket provider: missing ${hook}`);
    }
  }
  const imports = aggregate
    ? "useOrderTicketEditProps"
    : Object.values(hooks).join(", ");
  let consumers = `import { Profiler } from 'react';
import { recordProfile } from './reactProfile';
import { ${imports} } from './features/order-ticket/OrderTicketProvider';
`;
  for (const [group, hook] of Object.entries(hooks)) {
    const name = group[0].toUpperCase() + group.slice(1);
    const expression = aggregate
      ? `useOrderTicketEditProps().${groups[group] ?? group}`
      : `${hook}()`;
    consumers += `function ${name}Consumer() { const state = ${expression}; return <output>{String(state.${fields[group]})}</output>; }\n`;
  }
  consumers += "export function ProfileConsumers() { return <div hidden>";
  for (const group of Object.keys(hooks)) {
    const name = group[0].toUpperCase() + group.slice(1);
    consumers += `<Profiler id="${group}-consumer" onRender={recordProfile}><${name}Consumer /></Profiler>`;
  }
  consumers += "</div>; }\n";
  fs.writeFileSync(file("src/reactProfileConsumers.tsx"), consumers);
  const featurePath = file("src/features/order-ticket/OrderTicketFeature.tsx");
  let feature = fs.readFileSync(featurePath, "utf8");
  if (
    !feature.includes("<OrderTicketView />") ||
    !feature.includes("<OrderTicketProvider>")
  ) {
    throw new Error(
      "Unsupported OrderTicketFeature composition; update profiler instrumentation.",
    );
  }
  feature = `import { Profiler } from 'react';
import { recordProfile } from '../../reactProfile';
import { ProfileConsumers } from '../../reactProfileConsumers';
${feature}`;
  feature = feature.replace(
    "<OrderTicketView />",
    '<Profiler id="ticket-view" onRender={recordProfile}><OrderTicketView /></Profiler><ProfileConsumers />',
  );
  feature = feature.replace(
    "<OrderTicketProvider>",
    '<Profiler id="ticket-scope" onRender={recordProfile}><OrderTicketProvider>',
  );
  feature = feature.replace(
    "</OrderTicketProvider>",
    "</OrderTicketProvider></Profiler>",
  );
  fs.writeFileSync(featurePath, feature);
  const mainPath = file("src/main.tsx");
  let main = fs.readFileSync(mainPath, "utf8");
  if (!main.includes("import { StrictMode }") || !main.includes("<App />")) {
    throw new Error(
      "Unsupported app entry point; update profiler instrumentation.",
    );
  }
  main = `import { recordProfile } from './reactProfile';\n${main}`;
  main = main.replace(
    "import { StrictMode }",
    "import { StrictMode, Profiler }",
  );
  main = main.replace(
    "<App />",
    '<Profiler id="app" onRender={recordProfile}><App /></Profiler>',
  );
  fs.writeFileSync(mainPath, main);
}

function prepareSnapshots(repo, tempRoot, baselineRef) {
  const baselineCommit = git(repo, [
    "rev-parse",
    "--verify",
    `${baselineRef}^{commit}`,
  ])
    .toString()
    .trim();
  const archive = git(repo, ["archive", baselineCommit]);
  const snapshots = {};
  for (const label of ["main", "branch"]) {
    const root = path.join(tempRoot, label);
    fs.mkdirSync(root);
    const result = spawnSync("tar", ["-xf", "-", "-C", root], {
      input: archive,
    });
    if (result.status !== 0)
      throw new Error(
        result.stderr?.toString() ||
          "Could not extract baseline archive; Git and tar are required.",
      );
    const desktop = path.join(root, "apps/desktop");
    if (label === "branch") {
      for (const relative of [
        "apps/desktop/src",
        "apps/desktop/e2e",
        "config",
      ]) {
        const target = path.join(root, relative);
        fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(path.join(repo, relative), target, { recursive: true });
      }
      for (const relative of [
        "apps/desktop/package.json",
        "apps/desktop/tsconfig.json",
        "apps/desktop/index.html",
      ]) {
        fs.copyFileSync(path.join(repo, relative), path.join(root, relative));
      }
    }
    for (const relative of ["node_modules", "apps/desktop/node_modules"]) {
      const target = path.join(repo, relative);
      if (!fs.existsSync(target))
        throw new Error(
          "Install workspace dependencies with pnpm install --frozen-lockfile first.",
        );
      fs.symlinkSync(
        target,
        path.join(root, relative),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    const hash = sourceHash(path.join(desktop, "src"));
    instrument(desktop, repo, tempRoot);
    snapshots[label] = { desktop, sourceHash: hash };
  }
  const baselinePackage = JSON.parse(
    fs.readFileSync(path.join(snapshots.main.desktop, "package.json"), "utf8"),
  );
  const currentPackage = JSON.parse(
    fs.readFileSync(
      path.join(snapshots.branch.desktop, "package.json"),
      "utf8",
    ),
  );
  for (const name of [
    "react",
    "react-dom",
    "vite",
    "babel-plugin-react-compiler",
    "typescript",
  ]) {
    const version = (pkg) =>
      pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    if (version(baselinePackage) !== version(currentPackage)) {
      throw new Error(
        `Dependency ${name} differs across versions. This comparison requires matching dependencies.`,
      );
    }
  }
  return { baselineCommit, snapshots };
}

module.exports = { git, prepareSnapshots };
