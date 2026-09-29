// Decide e aplica a troca de arquivos do kit publicado.
// Não mexe em .env, output/, .git, .tmp nem node_modules.
// A pasta do helper (tem pack-cliente.mjs) não é sobrescrita.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

export const PRESERVE_ROOT = ['.env', 'output', '.git', '.tmp', 'node_modules'];

const preserve = new Set(PRESERVE_ROOT);

function firstSegment(rel) {
  return rel.split(/[/\\]/)[0];
}

function walkFiles(dir, base, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(base, abs).split('\\').join('/');
    if (preserve.has(firstSegment(rel))) continue;
    if (entry.isDirectory()) walkFiles(abs, base, out);
    else out.push(rel);
  }
  return out;
}

export function isKitSource(root) {
  return existsSync(join(root, 'scripts', 'pack-cliente.mjs'));
}

export function updateDecision({ report, kitSource }) {
  if (kitSource) {
    return {
      action: 'skip',
      translate: true,
      reason: 'origem',
      skipped: 'origem',
      manual: false,
      warning: report?.ok ? null : (report?.reason ?? 'github_unavailable'),
    };
  }
  if (!report?.ok) {
    return {
      action: 'stop',
      translate: false,
      reason: report?.reason ?? 'github_unavailable',
      manual: true,
    };
  }
  if (!report.update) {
    return { action: 'current', translate: true, reason: 'em_dia', manual: false };
  }
  return { action: 'install', translate: false, reason: 'update', manual: false };
}

export function assertZipEntries(names) {
  const list = names.filter((name) => name && !name.endsWith('/'));
  for (const name of list) {
    const norm = String(name).split('\\').join('/');
    if (norm.startsWith('/') || norm.split('/').includes('..')) {
      throw new Error('zip_inseguro');
    }
  }
  const tops = new Set(list.map((name) => name.split('/')[0]).filter(Boolean));
  if (tops.size !== 1) throw new Error('zip_raiz');
  return [...tops][0];
}

export function applyUpdateTree(fromDir, toDir) {
  const incoming = walkFiles(fromDir, fromDir);
  for (const rel of incoming) {
    const dest = join(toDir, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    cpSync(join(fromDir, rel), dest);
  }
  const keep = new Set(incoming);
  for (const rel of walkFiles(toDir, toDir)) {
    if (!keep.has(rel)) rmSync(join(toDir, rel), { force: true });
  }
  return { copied: incoming.length };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetries(fn, { attempts = 3, baseDelayMs = 400 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (i < attempts) await sleep(baseDelayMs * i);
    }
  }
  throw last;
}
