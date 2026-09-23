// Renderiza Mermaid em PNG com mmdc + Chrome local.
// Sem PNG válido: ok=false. Nao lanca. Nao envia o diagrama para fora.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const HELPER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 4).equals(PNG_MAGIC);
}

export function findChrome({ env = process.env, exists = existsSync } = {}) {
  const fromEnv = env.CHROME_PATH || env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && exists(fromEnv)) return fromEnv;
  return CHROME_CANDIDATES.find((p) => exists(p)) ?? null;
}

export function findMmdc({ root = HELPER_ROOT, exists = existsSync } = {}) {
  const cli = resolve(root, 'node_modules/@mermaid-js/mermaid-cli/src/cli.js');
  if (exists(cli)) return cli;
  const bin = resolve(root, 'node_modules/.bin/mmdc');
  if (exists(bin)) return bin;
  return null;
}

export function renderMermaidPngLocal(
  mermaid,
  {
    chromePath = findChrome(),
    mmdcPath = findMmdc(),
    spawn = spawnSync,
    nodePath = process.execPath,
    timeoutMs = 30_000,
  } = {},
) {
  const source = String(mermaid ?? '');
  if (!source.trim()) return { ok: false, reason: 'empty_mermaid' };
  if (!mmdcPath) return { ok: false, reason: 'mmdc_missing' };
  if (!chromePath) return { ok: false, reason: 'chrome_missing' };

  const dir = mkdtempSync(join(tmpdir(), 'mermaid-png-'));
  const mmdPath = join(dir, 'diagram.mmd');
  const pngPath = join(dir, 'diagram.png');
  const puppeteerPath = join(dir, 'puppeteer.json');
  try {
    writeFileSync(mmdPath, source);
    writeFileSync(
      puppeteerPath,
      `${JSON.stringify({
        executablePath: chromePath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      })}\n`,
    );
    const args = mmdcPath.endsWith('.js')
      ? [mmdcPath, '-i', mmdPath, '-o', pngPath, '-b', 'white', '-p', puppeteerPath]
      : ['-i', mmdPath, '-o', pngPath, '-b', 'white', '-p', puppeteerPath];
    const cmd = mmdcPath.endsWith('.js') ? nodePath : mmdcPath;
    const ran = spawn(cmd, args, { encoding: 'utf8', timeout: timeoutMs });
    if (ran.error) {
      return { ok: false, reason: 'mmdc_failed', error: String(ran.error.message ?? ran.error).slice(0, 200) };
    }
    if (ran.status) {
      return {
        ok: false,
        reason: 'mmdc_exit',
        status: ran.status,
        error: String(ran.stderr ?? ran.stdout ?? '').slice(0, 200),
      };
    }
    if (!existsSync(pngPath)) return { ok: false, reason: 'mmdc_no_png' };
    const buf = readFileSync(pngPath);
    if (!isPng(buf)) return { ok: false, reason: 'not_png', bytes: buf.length };
    return { ok: true, via: 'mmdc', bytes: buf, contentType: 'image/png' };
  } catch (err) {
    return { ok: false, reason: 'mmdc_failed', error: String(err?.message ?? err).slice(0, 200) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function renderMermaidPng(mermaid, opts = {}) {
  const source = String(mermaid ?? '');
  if (!source.trim()) return { ok: false, reason: 'empty_mermaid' };

  if (opts.local === false) return { ok: false, reason: 'local_skipped' };
  return renderMermaidPngLocal(source, opts);
}

export async function writeMermaidPng(mermaid, dest, opts) {
  const rendered = await renderMermaidPng(mermaid, opts);
  if (!rendered.ok) return rendered;
  writeFileSync(dest, rendered.bytes);
  return { ok: true, via: rendered.via, path: dest, bytes: rendered.bytes.length };
}
