import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export type FileChange = { path: string; content: string };

export type ApplyResult = {
  writtenFiles: string[];
  installedDependencies: string[];
  skippedDependencies: string[];
};

function normalizePathInput(raw: string): string {
  let s = (raw ?? "").toString().replace(/\\/g, "/").trim();
  // Some models include bullets or quotes.
  s = s.replace(/^[-*]\s+/, "");
  s = s.replace(/^['"`]|['"`]$/g, "");

  // Strip trailing line/col suffixes from error logs, e.g. "src/app/page.tsx:12:3".
  s = s.replace(/:(\d+)(?::\d+)?$/, "");

  // Normalize leading ./
  s = s.replace(/^\.\//, "");
  return s;
}

function sanitizeRelative(projectDir: string, p: string): string {
  const cleaned = normalizePathInput(p);
  if (!cleaned) throw new Error("Empty file path from AI");

  const projectAbs = path.resolve(projectDir);

  // Allow absolute paths *only if* they live inside the project directory.
  if (path.isAbsolute(cleaned) || /^[A-Za-z]:\//.test(cleaned)) {
    const abs = path.resolve(cleaned);
    const rel = path.relative(projectAbs, abs).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || rel.includes("../")) {
      throw new Error(`Absolute path not allowed (outside project): ${cleaned}`);
    }
    return sanitizeRelative(projectDir, rel);
  }

  const norm = path.posix.normalize(cleaned);
  if (norm.startsWith("..") || norm.includes("/../")) throw new Error(`Path traversal not allowed: ${cleaned}`);
  return norm;
}

async function readProjectPackageJson(projectDir: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(path.join(projectDir, "package.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectNextProject(pkgJson: any | null): boolean {
  if (!pkgJson) return false;
  const deps = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.devDependencies ?? {}),
  };
  return typeof deps.next === "string" && deps.next.length > 0;
}

function sanitizeNextFileContent(relPath: string, content: string): string {
  const p = relPath.replace(/\\/g, "/");
  const isCodeFile = /\.(tsx|ts|jsx|js)$/.test(p);
  if (!isCodeFile) return content;

  let out = content;

  // Fix common hallucination: react-router-dom in Next projects.
  // Only rewrite when it's clearly just Link.
  out = out.replace(
    /^\s*import\s+Link\s+from\s+['"]react-router-dom['"];?\s*$/gm,
    "import Link from 'next/link'"
  );
  out = out.replace(
    /^\s*import\s+\{\s*Link\s*\}\s+from\s+['"]react-router-dom['"];?\s*$/gm,
    "import Link from 'next/link'"
  );

  // Convert <Link to="..."> to <Link href="...">.
  out = out.replace(/<Link(\s[^>]*?)\bto=/g, "<Link$1href=");

  // Fix common type import mistake.
  out = out.replace(
    /^\s*import\s+\{\s*Metadata\s*\}\s+from\s+['"]next\/navigation['"];?\s*$/gm,
    "import type { Metadata } from 'next'"
  );

  // In App Router, pages typically should not import globals.css.
  // Remove any attempted globals.css import in page files.
  if (/(^|\/)page\.(tsx|ts|jsx|js)$/.test(p)) {
    out = out.replace(/^\s*import\s+[^;]*globals\.css['"];?\s*$/gm, "");

    // Next.js App Router restriction: you cannot export `metadata` or `generateMetadata`
    // from a Client Component (a file with a `"use client"` directive).
    // Some models mistakenly add both, which breaks `next dev` immediately.
    const head = out.split(/\r?\n/).slice(0, 30).join("\n");
    const hasUseClient = /^\s*['"]use client['"]\s*;?\s*$/m.test(head);
    const hasMetadataExport = /\bexport\s+const\s+metadata\b/.test(out) || /\bexport\s+(?:async\s+)?function\s+generateMetadata\b/.test(out);

    if (hasUseClient && hasMetadataExport) {
      // If the file doesn't appear to use client-only hooks, we can safely drop `use client`.
      const usesClientOnly = /\buse(State|Effect|LayoutEffect|Memo|Callback|Ref|Reducer|Transition|DeferredValue|Optimistic|SyncExternalStore|Id)\b/.test(out)
        || /\buse(Pathname|SearchParams|Params|Router)\b/.test(out)
        || /from\s+['"]next\/navigation['"]/.test(out)
        || /onClick\s*=/.test(out);

      if (!usesClientOnly) {
        out = out.replace(/^\s*['"]use client['"]\s*;?\s*\n?/m, "");
      } else {
        // Otherwise, remove metadata exports and rely on layout.tsx metadata.
        out = out.replace(/^\s*export\s+const\s+metadata\b[\s\S]*?^\s*\}[^\n]*;\s*\n?/m, "");
        out = out.replace(/^\s*export\s+(?:async\s+)?function\s+generateMetadata\b[\s\S]*?^\s*\}\s*\n?/m, "");

        // If we removed the export, clean up a now-unused Metadata import.
        if (!/\bMetadata\b/.test(out)) {
          out = out.replace(/^\s*import\s+type\s*\{\s*Metadata\s*\}\s+from\s+['"]next['"];?\s*\n?/gm, "");
        }
      }
    }
  }

  return out;
}

async function writeFile(projectDir: string, ch: FileChange, ctx: { isNextProject: boolean }): Promise<string> {
  const rel = sanitizeRelative(projectDir, ch.path);
  const dest = path.join(projectDir, ...rel.split("/"));
  await fs.mkdir(path.dirname(dest), { recursive: true });

  const content = ctx.isNextProject ? sanitizeNextFileContent(rel, ch.content) : ch.content;
  await fs.writeFile(dest, content, "utf-8");
  return rel;
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed with code ${code}`))
    );
  });
}

async function cmdOk(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

function splitDevDeps(deps: string[]): { prod: string[]; dev: string[] } {
  const prod: string[] = [];
  const dev: string[] = [];
  for (const d of deps) {
    const name = d.trim();
    if (!name) continue;
    if (name.startsWith("@types/")) dev.push(name);
    else prod.push(name);
  }
  return { prod, dev };
}

async function installBestEffort(opts: {
  cmd: string;
  argsForPkgs: (pkgs: string[]) => string[];
  cwd: string;
  pkgs: string[];
  label?: string;
}): Promise<{ installed: string[]; skipped: string[] }> {
  const pkgs = opts.pkgs.filter(Boolean);
  if (pkgs.length === 0) return { installed: [], skipped: [] };

  try {
    await run(opts.cmd, opts.argsForPkgs(pkgs), opts.cwd);
    return { installed: pkgs, skipped: [] };
  } catch {
    // If a batch install fails (often due to one invalid package), try each package individually.
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const pkg of pkgs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await run(opts.cmd, opts.argsForPkgs([pkg]), opts.cwd);
        installed.push(pkg);
      } catch {
        skipped.push(pkg);
      }
    }

    if (installed.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[studio/codegen] Failed to install dependencies (${opts.label ?? "deps"}); continuing without them: ${pkgs.join(", ")}`
      );
      return { installed: [], skipped: pkgs };
    }

    if (skipped.length) {
      // eslint-disable-next-line no-console
      console.warn(`[studio/codegen] Skipped failed dependencies (${opts.label ?? "deps"}): ${skipped.join(", ")}`);
    }

    return { installed, skipped };
  }
}

/**
 * Filter invalid / harmful dependencies before running installs.
 * This prevents:
 * - Tailwind directive tokens mistaken as packages (404)
 * - next/* import paths mistaken as packages (git ls-remote failures)
 * - shadcn generator mistaken as packages (shadcn/ui, ui, @shadcn/ui)
 * - URL/git dependencies (unreliable in this tool)
 */
function filterInvalidDeps(deps: string[], ctx: { isNextProject: boolean }): string[] {
  const denyExact = new Set<string>([
    // Tailwind directives (not packages)
    "@tailwindcss/base",
    "@tailwindcss/components",
    "@tailwindcss/utilities",
    "tailwindcss/base",
    "tailwindcss/components",
    "tailwindcss/utilities",
    "@tailwind/base",
    "@tailwind/components",
    "@tailwind/utilities",

    // shadcn generator hallucinations / wrong meta package
    "shadcn/ui",
    "shadcn-ui",
    "shadcn",
    "ui",
    "@shadcn/ui",

    // Known non-existent / hallucinated packages
    "@vercel/preact",

    // Next import paths commonly mistaken as deps
    "next/link",
    "next/image",
    "next/navigation",
    "next/router",
    "next/head",
    "next/server",

    // Common hallucination: there is no "@next/navigation" package
    "@next/navigation",
  ]);

  const out: string[] = [];
  for (const raw of deps) {
    const name = raw.trim();
    if (!name) continue;

    // Reject whitespace tokens
    if (/\s/.test(name)) continue;

    const lower = name.toLowerCase();

    // Block @next/* internal scopes (these are not meant to be installed directly).
    if (lower.startsWith("@next/")) continue;

    // Reject URL / git style deps
    if (
      lower.startsWith("git+") ||
      lower.startsWith("git://") ||
      lower.startsWith("ssh://") ||
      lower.startsWith("github:") ||
      lower.includes("github.com/") ||
      lower.endsWith(".git")
    ) {
      continue;
    }

    if (denyExact.has(name)) continue;

    // Non-existent package sometimes suggested by the AI. Skip it (including versioned forms).
    if (name === "@vercel/preact" || name.startsWith("@vercel/preact@")) continue;

    // In Next projects, disallow react-router.
    if (ctx.isNextProject) {
      if (name === "react-router" || name.startsWith("react-router@")) continue;
      if (name === "react-router-dom" || name.startsWith("react-router-dom@")) continue;
    }

    // If it looks like an import path (has "/") and it's not a scoped package (@scope/pkg),
    // treat it as invalid for installation.
    if (name.includes("/") && !name.startsWith("@")) {
      continue;
    }

    // Block most @tailwindcss/* except known real packages.
    if (name.startsWith("@tailwindcss/")) {
      const allow = new Set<string>(["@tailwindcss/postcss", "@tailwindcss/node", "@tailwindcss/oxide"]);
      if (!allow.has(name)) continue;
    }

    out.push(name);
  }

  return out;
}

async function installDeps(
  projectDir: string,
  deps: string[],
  ctx: { isNextProject: boolean }
): Promise<{ installed: string[]; skipped: string[] }> {
  const raw = Array.from(new Set(deps.map((d) => d.trim()).filter(Boolean)));
  const valid = filterInvalidDeps(raw, ctx);
  const validSet = new Set(valid);
  const blocked = raw.filter((d) => !validSet.has(d));

  const needed = Array.from(new Set(valid.map((d) => d.trim()).filter(Boolean)));
  if (needed.length === 0) return { installed: [], skipped: blocked };

  const prod: string[] = [];
  const dev: string[] = [];
  for (const d of needed) {
    if (d.startsWith("@types/")) dev.push(d);
    else prod.push(d);
  }

  const hasPnpm = await cmdOk("pnpm");
  const hasNpm = await cmdOk("npm");
  const hasYarn = await cmdOk("yarn");

  const installedAll: string[] = [];
  const skippedAll: string[] = [...blocked];

  if (hasPnpm) {
    const prodRes = await installBestEffort({
      cmd: "pnpm",
      cwd: projectDir,
      pkgs: prod,
      label: "prod",
      argsForPkgs: (pkgs) => ["add", ...pkgs],
    });

    const devRes = await installBestEffort({
      cmd: "pnpm",
      cwd: projectDir,
      pkgs: dev,
      label: "dev",
      argsForPkgs: (pkgs) => ["add", "-D", ...pkgs],
    });

    installedAll.push(...prodRes.installed, ...devRes.installed);
    skippedAll.push(...prodRes.skipped, ...devRes.skipped);
    return { installed: installedAll, skipped: skippedAll };
  }

  if (hasYarn) {
    const prodRes = await installBestEffort({
      cmd: "yarn",
      cwd: projectDir,
      pkgs: prod,
      label: "prod",
      argsForPkgs: (pkgs) => ["add", ...pkgs],
    });

    const devRes = await installBestEffort({
      cmd: "yarn",
      cwd: projectDir,
      pkgs: dev,
      label: "dev",
      argsForPkgs: (pkgs) => ["add", "-D", ...pkgs],
    });

    installedAll.push(...prodRes.installed, ...devRes.installed);
    skippedAll.push(...prodRes.skipped, ...devRes.skipped);
    return { installed: installedAll, skipped: skippedAll };
  }

  if (!hasNpm) {
    throw new Error("No package manager found (need pnpm, yarn, or npm).");
  }

  const prodRes = await installBestEffort({
    cmd: "npm",
    cwd: projectDir,
    pkgs: prod,
    label: "prod",
    argsForPkgs: (pkgs) => ["install", ...pkgs],
  });

  const devRes = await installBestEffort({
    cmd: "npm",
    cwd: projectDir,
    pkgs: dev,
    label: "dev",
    argsForPkgs: (pkgs) => ["install", "-D", ...pkgs],
  });

  installedAll.push(...prodRes.installed, ...devRes.installed);
  skippedAll.push(...prodRes.skipped, ...devRes.skipped);
  return { installed: installedAll, skipped: skippedAll };
}

export async function applyChanges(opts: {
  projectDir: string;
  files: FileChange[];
  dependencies?: string[];
}): Promise<ApplyResult> {
  const pkgJson = await readProjectPackageJson(opts.projectDir);
  const isNextProject = detectNextProject(pkgJson);

  const writtenFiles: string[] = [];
  for (const ch of opts.files) {
    const rel = await writeFile(opts.projectDir, ch, { isNextProject });
    writtenFiles.push(rel);
  }

  const depRes = await installDeps(opts.projectDir, opts.dependencies ?? [], { isNextProject });

  // NOTE: dependency install is best-effort. We continue even when installs fail.
  // The preview/build auto-fix loop can then either remove the dependency or pick a working package.
  return { writtenFiles, installedDependencies: depRes.installed, skippedDependencies: depRes.skipped };
}
