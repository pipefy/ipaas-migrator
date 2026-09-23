// No início da jornada: compara VERSION local com o GitHub e avisa se houver mais novo.
// Não baixa o repositório e não troca arquivos.
//
//   node scripts/cliente-versao.mjs

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENT_VERSION_URL, decodeVersionBody, versionReport } from './lib/cliente-versao.mjs';

function readLocal(root) {
  const versionFile = join(root, 'VERSION');
  if (existsSync(versionFile)) return readFileSync(versionFile, 'utf8').trim();
  const tree = join(root, 'scripts', 'lib', 'cliente-tree.mjs');
  if (!existsSync(tree)) return null;
  const match = readFileSync(tree, 'utf8').match(/CLIENT_VERSION = '(\d+\.\d+\.\d+)'/);
  return match ? match[1] : null;
}

async function remoteVersion() {
  const res = await fetch(CLIENT_VERSION_URL, {
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'ipaas-migrator',
    },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return decodeVersionBody(await res.text());
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = readLocal(root);
let remote = null;
let error = null;
try {
  remote = await remoteVersion();
} catch (err) {
  error = err?.message ?? err;
}

console.log(JSON.stringify(versionReport({ local, remote, error })));
