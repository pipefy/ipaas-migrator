// Copia um flow.json para a pasta Downloads. Não apaga o original. Não copia PNG.
//
//   node scripts/cliente-copiar-flow.mjs --file /abs/alerta.flow.json

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { downloadsDir, isFlowJson } from './lib/cliente-copiar-flow.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

function userDirsText() {
  if (process.platform !== 'linux') return '';
  const file = join(homedir(), '.config', 'user-dirs.dirs');
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

const file = arg('--file');
if (!file || !isFlowJson(file) || !existsSync(file)) {
  console.log(JSON.stringify({ ok: false, reason: 'nao_e_flow', file: file ?? null }));
  process.exit(2);
}

const destDir = downloadsDir({
  home: homedir(),
  platform: process.platform,
  userDirsText: userDirsText(),
  env: process.env,
});
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, basename(file));
copyFileSync(file, dest);
console.log(JSON.stringify({ ok: true, source: file, dest }));
