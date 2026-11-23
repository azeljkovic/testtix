#!/usr/bin/env node
/**
 * Runs the shell examples of docs/testing-guide.md against a running API in test mode, so the
 * guide's examples keep working as written (C5.4).
 *
 *   node scripts/check-guide-examples.mjs            # every example
 *   node scripts/check-guide-examples.mjs --list     # what would run
 *   node scripts/check-guide-examples.mjs 507 616    # only the examples starting on these lines
 *   node scripts/check-guide-examples.mjs --verbose  # print every example's output
 *
 * Every ```sh block runs in a fresh `bash -euo pipefail`, in its own temporary directory, after a
 * `POST /__test/reset`. An HTML comment on the line before the block changes that:
 *
 *   <!-- example: group=<name> -->  runs with the other blocks of that group, in one script, at
 *                                   the place of the group's first block (they share variables)
 *   <!-- example: http-errors -->   curl's 4xx/5xx answers don't fail the block (on purpose)
 *   <!-- example: skip <reason> --> not run
 *
 * Otherwise `curl` fails the block on any 4xx/5xx answer (`--fail-with-body`), unless the
 * example already passes `-f`. The API is http://localhost:3000 (`API_URL` to change it for the
 * reset; the examples themselves spell out localhost). `TEST_API_KEY` and `LOAD_TEST_KEY` are
 * passed through (empty if unset), as the examples use them.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GUIDE = new URL('../docs/testing-guide.md', import.meta.url);
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const TIMEOUT_MS = 120_000;

/** Fails curl on HTTP errors unless the call asks for -f itself (e.g. a readiness loop). */
const CURL_WRAPPER = `
curl() {
  local arg
  for arg in "$@"; do
    case $arg in --fail | --fail-with-body | -[!-]*f*) command curl "$@"; return;; esac
  done
  command curl --fail-with-body --show-error "$@"
}
`;

function parseBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '```sh') continue;
    const start = i + 1;
    let end = start;
    while (end < lines.length && lines[end].trim() !== '```') end++;
    let previous = i - 1;
    while (previous >= 0 && lines[previous].trim() === '') previous--;
    const marker = /^<!--\s*example:\s*(.*?)\s*-->$/.exec(lines[previous]?.trim() ?? '')?.[1];
    blocks.push({ line: start, code: lines.slice(start, end).join('\n'), marker: marker ?? '' });
    i = end;
  }
  return blocks;
}

function planRuns(blocks) {
  const runs = [];
  const groups = new Map();
  for (const block of blocks) {
    if (block.marker.startsWith('skip')) {
      runs.push({ lines: [block.line], skip: block.marker.slice(4).trim() || 'no reason given' });
      continue;
    }
    const group = /group=(\S+)/.exec(block.marker)?.[1];
    const httpErrors = block.marker.includes('http-errors');
    if (group !== undefined && groups.has(group)) {
      const run = groups.get(group);
      run.lines.push(block.line);
      run.code.push(block.code);
      run.httpErrors ||= httpErrors;
      continue;
    }
    const run = { lines: [block.line], code: [block.code], httpErrors, group };
    if (group !== undefined) groups.set(group, run);
    runs.push(run);
  }
  return runs;
}

async function resetServer() {
  const key = process.env.TEST_API_KEY;
  const res = await fetch(`${API_URL}/__test/reset`, {
    method: 'POST',
    headers: key ? { 'X-Test-Key': key } : {},
  });
  if (!res.ok) throw new Error(`POST /__test/reset answered ${res.status}: ${await res.text()}`);
}

function runScript(script, cwd) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-euo', 'pipefail', '-c', script], {
      cwd,
      env: {
        ...process.env,
        TEST_API_KEY: process.env.TEST_API_KEY ?? '',
        LOAD_TEST_KEY: process.env.LOAD_TEST_KEY ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      output += `\n(timed out after ${TIMEOUT_MS / 1000} s)`;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const args = process.argv.slice(2);
const list = args.includes('--list');
const verbose = args.includes('--verbose');
const only = new Set(args.filter((arg) => /^\d+$/.test(arg)).map(Number));

const runs = planRuns(parseBlocks(await readFile(GUIDE, 'utf8')));
const selected = only.size === 0 ? runs : runs.filter((r) => r.lines.some((l) => only.has(l)));
const label = (run) =>
  `line ${run.lines.join(' + ')}${run.group === undefined ? '' : ` (group ${run.group})`}`;

if (list) {
  for (const run of selected)
    console.log(`${run.skip === undefined ? 'run ' : 'skip'} ${label(run)}`);
  process.exit(0);
}

let failed = 0;
for (const run of selected) {
  if (run.skip !== undefined) {
    console.log(`- skipped ${label(run)}: ${run.skip}`);
    continue;
  }
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), 'testtix-guide-'));
  try {
    await resetServer();
    const script = (run.httpErrors ? '' : CURL_WRAPPER) + run.code.join('\n');
    const { code, output } = await runScript(script, dir);
    const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
    if (code === 0) {
      console.log(`✓ ${label(run)} (${took})`);
      if (verbose) console.log(output.replace(/^/gm, '  │ '));
    } else {
      failed++;
      console.log(
        `✗ ${label(run)} exited with ${code} (${took})\n${output.replace(/^/gm, '  │ ')}`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await resetServer();
const ran = selected.filter((run) => run.skip === undefined).length;
console.log(`\n${ran - failed} of ${ran} examples passed`);
process.exit(failed === 0 ? 0 : 1);
