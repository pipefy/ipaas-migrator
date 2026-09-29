// Compara VERSION local com o GitHub. Não baixa e não troca arquivos.
// A instalação da versão nova é scripts/cliente-atualizar.mjs.
//
//   node scripts/cliente-versao.mjs

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENT_VERSION_URL, decodeVersionBody, readLocalVersion, versionReport } from './lib/cliente-versao.mjs';

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
const local = readLocalVersion(root);
let remote = null;
let error = null;
try {
  remote = await remoteVersion();
} catch (err) {
  error = err?.message ?? err;
}

console.log(JSON.stringify(versionReport({ local, remote, error })));
