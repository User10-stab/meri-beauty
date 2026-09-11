#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, platform } from "node:os";

const IS_WIN = platform() === "win32";
const REPO_ROOT = process.cwd();
const REPORTS_DIR = join(REPO_ROOT, "security-reports");
const TOOLS_DIR =
  process.env.SECURITY_TOOLS_DIR || join(tmpdir(), "opencode", "security-tools");
const BIN_DIR = join(TOOLS_DIR, "bin");
const VENV_BIN = join(TOOLS_DIR, "venv", IS_WIN ? "Scripts" : "bin");
const exe = (name) => (IS_WIN ? `${name}.exe` : name);
const toolPath = (name) => join(BIN_DIR, exe(name));
const semgrepPath = () => join(VENV_BIN, exe("semgrep"));

const ONLY = parseArgs(process.argv.slice(2));
const enabled = (name) => !ONLY || ONLY.includes(name);

function parseArgs(argv) {
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") only = argv[++i];
    else if (a.startsWith("--only=")) only = a.slice("--only=".length);
  }
  return only
    ? only.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...opts,
  });
}

function heading(text) {
  console.log(`\n=== ${text} ===`);
}

mkdirSync(REPORTS_DIR, { recursive: true });

const results = [];
const record = (tool, status, summary) => results.push({ tool, status, summary });

// ---------------------------------------------------------------------------
// npm audit — production dependencies
// ---------------------------------------------------------------------------
if (enabled("npm")) {
  heading("npm audit (production dependencies)");
  let npmCmd = IS_WIN ? "npm.cmd" : "npm";
  let npmArgs = ["audit", "--omit=dev", "--json"];
  const npmOpts = {};
  if (IS_WIN) {
    const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(cli)) {
      npmCmd = process.execPath;
      npmArgs = [cli, ...npmArgs];
    } else {
      npmOpts.shell = true;
    }
  }
  const res = run(npmCmd, npmArgs, npmOpts);
  if (res.stdout) writeFileSync(join(REPORTS_DIR, "npm-audit.json"), res.stdout);
  let summary = `could not parse (exit ${res.status})`;
  try {
    const data = JSON.parse(res.stdout);
    const v = data.metadata?.vulnerabilities ?? {};
    summary = `critical=${v.critical ?? 0} high=${v.high ?? 0} moderate=${v.moderate ?? 0} low=${v.low ?? 0}`;
    for (const [name, info] of Object.entries(data.vulnerabilities ?? {})) {
      console.log(
        `  [${info.severity}] ${name} -> ${info.fixAvailable ? "fix available" : "no fix"}`
      );
    }
  } catch {
    /* keep default summary */
  }
  console.log(`  ${summary}`);
  record("npm audit", res.status <= 1 ? "ok" : "error", summary);
}

// ---------------------------------------------------------------------------
// gitleaks — secrets in git history
// ---------------------------------------------------------------------------
if (enabled("gitleaks")) {
  heading("gitleaks (secrets in git history)");
  const bin = toolPath("gitleaks");
  const outPath = join(REPORTS_DIR, "gitleaks.json");
  if (!existsSync(bin)) {
    console.log(`  not installed at ${bin} — run: npm run security:install`);
    record("gitleaks", "missing", "");
  } else {
    run(bin, [
      "git",
      ".",
      "--report-format",
      "json",
      "--report-path",
      outPath,
      "--exit-code",
      "0",
    ]);
    let count = -1;
    try {
      const data = JSON.parse(readFileSync(outPath, "utf8"));
      count = Array.isArray(data) ? data.length : (data.findings?.length ?? 0);
      for (const f of Array.isArray(data) ? data : []) {
        console.log(`  [${f.RuleID}] ${f.File}:${f.StartLine}`);
      }
    } catch {
      /* leave -1 */
    }
    console.log(`  findings: ${count}`);
    record("gitleaks", "ok", `findings=${count}`);
  }
}

// ---------------------------------------------------------------------------
// trivy — deps, secrets, misconfig
// ---------------------------------------------------------------------------
if (enabled("trivy")) {
  heading("trivy fs (deps, secrets, misconfig)");
  const bin = toolPath("trivy");
  const outPath = join(REPORTS_DIR, "trivy.json");
  if (!existsSync(bin)) {
    console.log(`  not installed at ${bin} — run: npm run security:install`);
    record("trivy", "missing", "");
  } else {
    run(
      bin,
      [
        "fs",
        "--scanners",
        "vuln,secret,misconfig",
        "--skip-dirs",
        "node_modules",
        "--skip-dirs",
        ".next",
        "--skip-dirs",
        ".git",
        "--skip-dirs",
        ".claude",
        "--skip-dirs",
        "test-results",
        "--skip-dirs",
        "playwright-report-money",
        "--skip-dirs",
        "security-reports",
        "--format",
        "json",
        "--output",
        outPath,
        "--quiet",
        ".",
      ],
      { env: { ...process.env, TRIVY_CACHE_DIR: join(TOOLS_DIR, "data", "trivy") } }
    );
    let vulns = 0;
    let secrets = 0;
    let misconfig = 0;
    try {
      const data = JSON.parse(readFileSync(outPath, "utf8"));
      for (const r of data.Results ?? []) {
        vulns += (r.Vulnerabilities ?? []).length;
        secrets += (r.Secrets ?? []).length;
        misconfig += (r.Misconfigurations ?? []).length;
      }
      for (const r of data.Results ?? []) {
        for (const v of r.Vulnerabilities ?? []) {
          console.log(`  [${v.Severity}] ${v.PkgName} ${v.InstalledVersion} -> ${v.FixedVersion}`);
        }
      }
    } catch {
      /* leave counts */
    }
    console.log(`  vulns=${vulns} secrets=${secrets} misconfig=${misconfig}`);
    record("trivy", "ok", `vulns=${vulns} secrets=${secrets} misconfig=${misconfig}`);
  }
}

// ---------------------------------------------------------------------------
// semgrep — SAST
// ---------------------------------------------------------------------------
if (enabled("semgrep")) {
  heading("semgrep (SAST)");
  const bin = semgrepPath();
  const outPath = join(REPORTS_DIR, "semgrep.json");
  if (!existsSync(bin)) {
    console.log(`  not installed at ${bin} — run: npm run security:install`);
    record("semgrep", "missing", "");
  } else {
    const configs = ["p/default", "p/owasp-top-ten", "p/nextjs", "p/secrets"];
    const args = ["scan"];
    for (const c of configs) args.push("--config", c);
    for (const d of [
      "node_modules",
      ".next",
      ".git",
      ".claude",
      "test-results",
      "playwright-report-money",
      "security-reports",
      ".codex-deploy",
    ]) {
      args.push("--exclude", d);
    }
    args.push("--metrics", "off", "--json", "--output", outPath, ".");
    run(bin, args, { env: { ...process.env, SEMGREP_SEND_METRICS: "off" } });
    try {
      const data = JSON.parse(readFileSync(outPath, "utf8"));
      const by = { ERROR: 0, WARNING: 0, INFO: 0 };
      const rules = new Map();
      for (const r of data.results ?? []) {
        by[r.extra.severity] = (by[r.extra.severity] ?? 0) + 1;
        rules.set(r.check_id, (rules.get(r.check_id) ?? 0) + 1);
      }
      console.log(`  ERROR=${by.ERROR} WARNING=${by.WARNING} INFO=${by.INFO}`);
      for (const [id, n] of [...rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        console.log(`  ${n}x ${id}`);
      }
      record("semgrep", "ok", `ERROR=${by.ERROR} WARNING=${by.WARNING} INFO=${by.INFO}`);
    } catch {
      record("semgrep", "error", "could not parse report");
    }
  }
}

// ---------------------------------------------------------------------------
heading("SUMMARY");
for (const r of results) console.log(`  ${r.tool.padEnd(11)} ${r.status.padEnd(8)} ${r.summary}`);
console.log(`\nReports: ${REPORTS_DIR}`);
