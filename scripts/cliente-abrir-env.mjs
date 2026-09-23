// Garante .env e abre no editor de texto do SO (Bloco de notas no Windows).
// Nao imprime o conteudo. Nao preenche a chave.
//
//   node scripts/cliente-abrir-env.mjs

import { copyFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(from) {
  let dir = resolve(from);
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'engine', 'run.ts')) && existsSync(resolve(dir, '.env.example'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function openInEditor(file) {
  const p = platform();
  if (p === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', 'notepad.exe', file], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return 'notepad.exe';
  }
  if (p === 'darwin') {
    const child = spawn('open', ['-e', file], { detached: true, stdio: 'ignore' });
    child.unref();
    return 'TextEdit';
  }
  const child = spawn('xdg-open', [file], { detached: true, stdio: 'ignore' });
  child.unref();
  return 'xdg-open';
}

function main() {
  const root = findRoot(dirname(fileURLToPath(import.meta.url))) ?? findRoot(process.cwd());
  if (!root) {
    console.log(JSON.stringify({ ok: false, reason: 'root_not_found' }));
    process.exit(2);
  }
  const example = resolve(root, '.env.example');
  const envPath = resolve(root, '.env');
  let created = false;
  if (!existsSync(envPath)) {
    if (!existsSync(example)) {
      console.log(JSON.stringify({ ok: false, reason: 'missing_example', root }));
      process.exit(2);
    }
    copyFileSync(example, envPath);
    created = true;
  }
  let editor = null;
  try {
    editor = openInEditor(envPath);
  } catch (err) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: 'open_failed',
        file: envPath,
        created,
        message: String(err?.message ?? err),
      }),
    );
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, file: envPath, editor, created }));
}

main();
