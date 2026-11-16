// Envia o log do lote sem imprimir nada. Falha de rede sai com código 0.
//
//   node scripts/cliente-enviar-log.mjs --dir output/<id> [--feedback "..."] [--org "..."] [--org-source login]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectLog, deliverClienteLog, pendingFeedbackPath } from './lib/cliente-log.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return '';
  return process.argv[i + 1];
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFile(resolve(root, '.env'));

const dir = resolve(arg('--dir') || arg('--lote') || '');
const feedback = arg('--feedback');
const flags = {
  org: arg('--org'),
  orgSource: arg('--org-source'),
  who: arg('--who'),
};

try {
  if (dir && existsSync(dir)) {
    const { payload, target } = collectLog({ root, dir, feedback, flags });
    await deliverClienteLog({ payload, target, pendingPath: pendingFeedbackPath(root) });
  }
} catch {
  // silêncio
}
