// Instala a versão mais nova do kit publicado antes de traduzir.
// Tenta de novo rede, zip, npm ci e smoke. Se falhar, restaura a pasta
// (menos .env e output/) e devolve translate: false.
//
//   node scripts/cliente-atualizar.mjs
//   node scripts/cliente-atualizar.mjs --check

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import {
  applyUpdateTree,
  assertZipEntries,
  isKitSource,
  updateDecision,
  withRetries,
} from './lib/cliente-atualizar.mjs';
import {
  CLIENT_VERSION_URL,
  CLIENT_ZIP_URL,
  decodeVersionBody,
  readLocalVersion,
  versionReport,
} from './lib/cliente-versao.mjs';

function flag(name) {
  return process.argv.includes(name);
}

function emit(payload, code) {
  console.log(JSON.stringify(payload));
  process.exit(code);
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'ipaas-migrator',
    },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60000),
    headers: { 'User-Agent': 'ipaas-migrator' },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function run(cmd, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveRun(out);
      else reject(new Error(`${cmd} exit ${code}: ${out.slice(-400)}`));
    });
  });
}

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function incomingVersion(dir) {
  const versionFile = join(dir, 'VERSION');
  const engine = join(dir, 'engine', 'run.ts');
  if (!existsSync(versionFile) || !existsSync(engine)) throw new Error('kit_incompleto');
  return readFileSync(versionFile, 'utf8').trim();
}

async function smoke(root) {
  await run(
    'node',
    ['scripts/transpilar-receita.mjs', '--recipe', 'examples/smoke.recipe.json', '--out', '.tmp/smoke-update'],
    root,
  );
}

async function installTree(root, incomingDir) {
  const backup = mkdtempSync(join(tmpdir(), 'ipaas-migrator-backup-'));
  applyUpdateTree(root, backup);
  try {
    applyUpdateTree(incomingDir, root);
    await withRetries(() => run(npmBin(), ['ci'], root), { attempts: 3, baseDelayMs: 1500 });
    await withRetries(() => run('node', ['scripts/instalar-cliente.mjs', '--navegador'], root), {
      attempts: 2,
      baseDelayMs: 500,
    });
    try {
      await smoke(root);
    } catch {
      await run(npmBin(), ['ci'], root);
      await smoke(root);
    }
    return { restored: false };
  } catch (err) {
    let restored = false;
    try {
      applyUpdateTree(backup, root);
      await run(npmBin(), ['ci'], root);
      restored = true;
    } catch {
      restored = false;
    }
    err.restored = restored;
    throw err;
  } finally {
    rmSync(backup, { recursive: true, force: true });
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = readLocalVersion(root);
const kitSource = isKitSource(root);
let remote = null;
let error = null;
try {
  const body = await withRetries(() => fetchText(CLIENT_VERSION_URL), { attempts: 3, baseDelayMs: 800 });
  remote = decodeVersionBody(body);
} catch (err) {
  error = err?.message ?? err;
}

const report = versionReport({ local, remote, error });
const decision = updateDecision({ report, kitSource });

if (flag('--check') || decision.action !== 'install') {
  emit(
    {
      ...report,
      ...decision,
      translate: decision.translate,
      updated: false,
      local: report.local,
      remote: report.remote,
    },
    decision.translate ? 0 : 2,
  );
}

let zipDir;
let payload;
let code = 2;
try {
  const buf = await withRetries(() => fetchBuffer(CLIENT_ZIP_URL), { attempts: 3, baseDelayMs: 800 });
  const zip = new AdmZip(buf);
  const names = zip.getEntries().map((entry) => entry.entryName);
  const top = assertZipEntries(names);
  zipDir = mkdtempSync(join(tmpdir(), 'ipaas-migrator-zip-'));
  zip.extractAllTo(zipDir, true);
  const incomingDir = join(zipDir, top);
  const got = incomingVersion(incomingDir);
  if (versionReport({ local, remote: got }).update !== true) {
    throw new Error('remote_nao_e_mais_novo');
  }
  await installTree(root, incomingDir);
  payload = {
    ok: true,
    translate: true,
    updated: true,
    action: 'install',
    reason: 'updated',
    manual: false,
    local: readLocalVersion(root),
    remote: got,
    repo: report.repo,
  };
  code = 0;
} catch (err) {
  payload = {
    ok: false,
    translate: false,
    updated: false,
    action: 'stop',
    reason: String(err?.message ?? err).slice(0, 200),
    manual: true,
    restored: Boolean(err?.restored),
    local,
    remote,
    repo: report.repo,
  };
  code = 2;
} finally {
  if (zipDir) rmSync(zipDir, { recursive: true, force: true });
}
emit(payload, code);
