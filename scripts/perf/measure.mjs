#!/usr/bin/env node
// Windows-only process CPU / working-set sampler for the One Trick process tree.
// Samples Win32_PerfFormattedData_PerfProc_Process through PowerShell once per interval.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
const PS_SCRIPT = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
  "$perf = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | " +
  "Select-Object -Property Name,IDProcess,PercentProcessorTime,WorkingSetPrivate); " +
  "$procs = @(Get-CimInstance Win32_Process | " +
  "Select-Object -Property ProcessId,ParentProcessId,Name,CommandLine); " +
  "@{ perf = $perf; procs = $procs } | ConvertTo-Json -Depth 4 -Compress";
const USAGE = `Usage: node scripts/perf/measure.mjs [options]
  --seconds <n>     sampling duration (default 60)
  --interval <ms>   sample period (default 1000)
  --root-pid <pid> | --name <text>   process tree (default name "electron")
  --out <file>      report path (default ./perf-measure-report.json)
  --label <text>    scenario label; --help`;

function parseArgs(argv) {
  const o = { interval: 1000, seconds: 60, out: './perf-measure-report.json', name: 'electron', rootPid: null, label: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--interval') o.interval = Number(next());
    else if (a === '--seconds') o.seconds = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--name') o.name = next() || o.name;
    else if (a === '--root-pid') o.rootPid = Number(next());
    else if (a === '--label') o.label = next() || '';
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else { console.error(`[measure] unknown option: ${a}\n\n${USAGE}`); process.exit(2); }
  }
  if (!Number.isFinite(o.interval) || o.interval < 50) { console.error('[measure] --interval must be >= 50 ms'); process.exit(2); }
  if (!Number.isFinite(o.seconds) || o.seconds <= 0) { console.error('[measure] --seconds must be > 0'); process.exit(2); }
  if (o.rootPid !== null && (!Number.isInteger(o.rootPid) || o.rootPid <= 0)) { console.error('[measure] --root-pid must be a positive integer'); process.exit(2); }
  if (typeof o.out !== 'string' || !o.out) { console.error('[measure] --out needs a file path'); process.exit(2); }
  return o;
}
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summarize(values) {
  if (!values.length) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, n) => sum + n, 0);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return { avg: total / sorted.length, p95, max: sorted[sorted.length - 1] };
}
function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
// Select the seed processes, then every descendant from Win32_Process parents.
function selectIds(procs, args) {
  const children = new Map();
  for (const p of procs) {
    const parent = Number(p.ParentProcessId);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(Number(p.ProcessId));
  }
  let seeds;
  if (args.rootPid !== null) seeds = [args.rootPid];
  else {
    const needle = args.name.toLowerCase();
    seeds = procs.filter((p) => String(p.Name || '').toLowerCase().includes(needle)).map((p) => Number(p.ProcessId));
  }
  const seen = new Set();
  const queue = [...new Set(seeds)];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of children.get(id) || []) if (!seen.has(child)) queue.push(child);
  }
  return seen;
}
// Electron's --type= flag is authoritative; the main/browser process has none.
// Renderers whose command line mentions overlay are split out; otherwise "renderer".
function classify(proc) {
  const cmd = String(proc.CommandLine || '');
  const match = /--type=([a-z0-9-]+)/i.exec(cmd);
  if (!match) return 'browser';
  const type = match[1].toLowerCase();
  if (type === 'renderer' && /overlay/i.test(cmd)) return 'renderer-overlay';
  return type;
}
async function takeSample(cores, args) {
  const { stdout } = await execFileP('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT,
  ], { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: Math.max(30000, args.interval * 3) });

  let parsed;
  try { parsed = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); }
  catch { throw new Error(`PowerShell returned non-JSON: ${stdout.slice(0, 200)}`); }
  const procs = asArray(parsed.procs);
  const perf = asArray(parsed.perf);
  const procById = new Map(procs.map((p) => [Number(p.ProcessId), p]));
  const perfById = new Map();
  for (const row of perf) {
    const id = Number(row.IDProcess);
    if (!perfById.has(id)) perfById.set(id, row);
  }

  const rows = [];
  for (const id of selectIds(procs, args)) {
    const proc = procById.get(id);
    if (!proc) continue;
    const row = perfById.get(id) || {};
    rows.push({
      id,
      type: classify(proc),
      cpuPct: Number(row.PercentProcessorTime || 0) / cores,
      workingSetMB: Number(row.WorkingSetPrivate || 0) / (1024 * 1024),
    });
  }
  return rows;
}
function aggregate(samples) {
  const types = [...new Set(samples.flatMap((rows) => rows.map((r) => r.type)))].sort();
  const byType = {};
  for (const type of types) {
    const groups = samples.map((rows) => rows.filter((r) => r.type === type));
    const cpu = summarize(groups.map((rows) => rows.reduce((sum, r) => sum + r.cpuPct, 0)));
    const mem = summarize(groups.map((rows) => rows.reduce((sum, r) => sum + r.workingSetMB, 0)));
    byType[type] = {
      avgCpuPct: round(cpu.avg),
      p95CpuPct: round(cpu.p95),
      maxCpuPct: round(cpu.max),
      avgWorkingSetMB: round(mem.avg),
      maxWorkingSetMB: round(mem.max),
      processCount: Math.max(...groups.map((rows) => rows.length)),
    };
  }
  const totalCpu = summarize(samples.map((rows) => rows.reduce((sum, r) => sum + r.cpuPct, 0)));
  const totalMem = summarize(samples.map((rows) => rows.reduce((sum, r) => sum + r.workingSetMB, 0)));
  return {
    byType,
    total: {
      avgCpuPct: round(totalCpu.avg),
      p95CpuPct: round(totalCpu.p95),
      avgWorkingSetMB: round(totalMem.avg),
      maxWorkingSetMB: round(totalMem.max),
    },
  };
}
async function main() {
  if (process.platform !== 'win32') {
    console.error('[measure] this sampler requires Windows (PowerShell + Win32 CIM counters).');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const cores = os.cpus().length || 1;
  const target = Math.max(1, Math.ceil((args.seconds * 1000) / args.interval));
  const samples = [];
  const startedAt = Date.now();

  for (let i = 0; i < target; i++) {
    const sampleStarted = Date.now();
    let rows = [];
    try { rows = await takeSample(cores, args); }
    catch (error) {
      console.error(`[measure] sample ${i + 1}/${target} failed: ${error.message}`);
      if (i === 0) process.exit(1);
    }
    if (i === 0 && rows.length === 0) {
      const selector = args.rootPid !== null ? `root pid ${args.rootPid}` : `process name containing "${args.name}"`;
      console.error(`[measure] no processes matched ${selector}; is the app running?`);
      process.exit(1);
    }
    samples.push(rows);
    if (i + 1 < target) await sleep(Math.max(0, args.interval - (Date.now() - sampleStarted)));
  }

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const { byType, total } = aggregate(samples);
  const report = {
    ...(args.label ? { label: args.label } : {}),
    samples: samples.length,
    seconds: round(elapsedSeconds, 1),
    cores,
    byType,
    total,
  };
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `[measure] ${args.label ? `${args.label}: ` : ''}total CPU avg ${total.avgCpuPct}% p95 ${total.p95CpuPct}%` +
    ` | working set avg ${total.avgWorkingSetMB} MB max ${total.maxWorkingSetMB} MB`,
  );
}

main().catch((error) => {
  console.error('[measure]', error && error.stack ? error.stack : error);
  process.exit(1);
});
