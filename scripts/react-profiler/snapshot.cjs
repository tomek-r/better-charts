const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
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

function exportedHookFile(srcRoot, hook) {
  const roots = [
    path.join(srcRoot, "features/order-ticket/editor"),
    path.join(srcRoot, "features/order-ticket/state"),
    path.join(srcRoot, "features/order-ticket/OrderTicketProvider.tsx"),
  ];
  // Only context hooks with no parameters are safe to call without arguments.
  // The baseline also has parameterized `use*` helpers with these names (for
  // example `useOrderTicketPricing(ticket)`), which are not context readers.
  const exportPattern = new RegExp(
    `export\\s+function\\s+${hook}\\s*\\(\\s*\\)`,
  );

  function exportedFiles(root) {
    if (!fs.existsSync(root)) return [];
    const stat = fs.statSync(root);
    if (stat.isFile()) return [root];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) return exportedFiles(file);
        return entry.isFile() && /\.tsx?$/.test(entry.name) ? [file] : [];
      });
  }

  for (const root of roots) {
    const matches = exportedFiles(root).filter((file) =>
      exportPattern.test(fs.readFileSync(file, "utf8")),
    );
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous ticket hook export ${hook}: ${matches.join(", ")}`,
      );
    }
    if (matches.length === 1) {
      return `./${path
        .relative(srcRoot, matches[0])
        .split(path.sep)
        .join("/")
        .replace(/\.tsx?$/, "")}`;
    }
  }
  throw new Error(`Unsupported ticket source: missing exported hook ${hook}`);
}

function instrument(desktop, repo, tempRoot, mode = "development") {
  const file = (name) => path.join(desktop, name);
  const req = createRequire(path.join(desktop, "package.json"));
  const version = JSON.parse(
    fs.readFileSync(file("package.json"), "utf8"),
  ).version;
  const config = `import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
export default defineConfig({
  cacheDir: ${JSON.stringify(file(".profile-cache"))},
  build: { sourcemap: true, rolldownOptions: { output: { keepNames: true } } },
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  envPrefix: ['VITE_', 'TAURI_'],
  define: { __APP_VERSION__: ${JSON.stringify(JSON.stringify(version))} },
  server: { host: '127.0.0.1', strictPort: true, fs: { allow: ${JSON.stringify([fs.realpathSync(tempRoot), repo])} } }${
    mode === "production"
      ? `,\n  preview: { host: '127.0.0.1', strictPort: true },\n  resolve: { alias: { 'react-dom/client': ${JSON.stringify(req.resolve("react-dom/profiling"))} } }`
      : ""
  }
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
  const resolvedHooks = {};
  if (!aggregate) {
    for (const hook of Object.values(hooks)) {
      resolvedHooks[hook] = exportedHookFile(file("src"), hook);
    }
  }
  let consumers = `import { Profiler, useLayoutEffect } from 'react';
import { recordProfile } from './reactProfile';
function recordCommittedConsumerExecution(group: string) {
  const profileWindow = window as Window & { __reactProfileConsumerCommits?: Record<string, number> };
  const counters = profileWindow.__reactProfileConsumerCommits ??= {};
  counters[group] = (counters[group] ?? 0) + 1;
}
`;
  if (aggregate) {
    consumers += `import { useOrderTicketEditProps } from './features/order-ticket/OrderTicketProvider';\n`;
  } else {
    for (const hook of Object.values(hooks)) {
      consumers += `import { ${hook} } from '${resolvedHooks[hook]}';\n`;
    }
  }
  for (const [group, hook] of Object.entries(hooks)) {
    const name = group[0].toUpperCase() + group.slice(1);
    const expression = aggregate
      ? `useOrderTicketEditProps().${groups[group] ?? group}`
      : `${hook}()`;
    consumers += `function ${name}Consumer() { const state = ${expression}; useLayoutEffect(() => { recordCommittedConsumerExecution('${group}'); }); return <output>{String(state.${fields[group]})}</output>; }\n`;
  }
  consumers += "export function ProfileConsumers() { return <div hidden>";
  for (const group of Object.keys(hooks)) {
    const name = group[0].toUpperCase() + group.slice(1);
    consumers += `<Profiler id="${group}-consumer" onRender={recordProfile}><${name}Consumer /></Profiler>`;
  }
  consumers += "</div>; }\n";
  fs.writeFileSync(file("src/reactProfileConsumers.tsx"), consumers);
  const featurePath = file("src/features/order-ticket/OrderTicketFeature.tsx");
  const legacyFeature = fs.existsSync(featurePath);
  const scopePath = legacyFeature
    ? featurePath
    : file("src/features/app-workspace/AppWorkspaceView.tsx");
  const viewPath = legacyFeature
    ? featurePath
    : file("src/features/order-ticket/OrderTicketPanelContent.tsx");
  let scope = fs.readFileSync(scopePath, "utf8");
  let view = scopePath === viewPath ? scope : fs.readFileSync(viewPath, "utf8");
  if (
    !view.includes("<OrderTicketView />") ||
    !scope.includes("<OrderTicketProvider>")
  ) {
    throw new Error(
      "Unsupported ticket composition; update profiler instrumentation.",
    );
  }
  const profileImports = `import { Profiler } from 'react';
import { recordProfile } from '../../reactProfile';
`;
  view = `${profileImports}import { ProfileConsumers } from '../../reactProfileConsumers';
${view}`;
  view = view.replace(
    "<OrderTicketView />",
    "<Profiler id=\"ticket-view\" onRender={recordProfile}><OrderTicketView /></Profiler>{'__reactFullProfile' in window ? null : <ProfileConsumers />}",
  );
  scope = scopePath === viewPath ? view : `${profileImports}${scope}`;
  scope = scope.replace(
    "<OrderTicketProvider>",
    '<Profiler id="ticket-scope" onRender={recordProfile}><OrderTicketProvider>',
  );
  scope = scope.replace(
    "</OrderTicketProvider>",
    "</OrderTicketProvider></Profiler>",
  );
  fs.writeFileSync(scopePath, scope);
  if (viewPath !== scopePath) fs.writeFileSync(viewPath, view);
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

function prepareSnapshots(repo, tempRoot, baselineRef, mode = "development") {
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
    instrument(desktop, repo, tempRoot, mode);
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
