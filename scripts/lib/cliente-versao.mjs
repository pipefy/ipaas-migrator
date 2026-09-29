// Compara a versão local do kit cliente com o VERSION publicado no GitHub.
// Quem baixa e troca arquivos é scripts/cliente-atualizar.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CLIENT_REPO_WEB = 'https://github.com/pipefy/ipaas-migrator';
export const CLIENT_VERSION_URL = 'https://api.github.com/repos/pipefy/ipaas-migrator/contents/VERSION?ref=main';
export const CLIENT_ZIP_URL = 'https://codeload.github.com/pipefy/ipaas-migrator/zip/refs/heads/main';

export function readLocalVersion(root) {
  const versionFile = join(root, 'VERSION');
  if (existsSync(versionFile)) return readFileSync(versionFile, 'utf8').trim();
  const tree = join(root, 'scripts', 'lib', 'cliente-tree.mjs');
  if (!existsSync(tree)) return null;
  const match = readFileSync(tree, 'utf8').match(/CLIENT_VERSION = '(\d+\.\d+\.\d+)'/);
  return match ? match[1] : null;
}

export function decodeVersionBody(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('{')) return trimmed;
  const body = JSON.parse(trimmed);
  if (body.encoding === 'base64' && body.content) {
    return Buffer.from(body.content, 'base64').toString('utf8').trim();
  }
  return trimmed;
}

export function parseVersion(text) {
  const match = String(text ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(local, remote) {
  const left = parseVersion(local);
  const right = parseVersion(remote);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

export function versionReport({ local, remote, error }) {
  const repo = CLIENT_REPO_WEB;
  if (!parseVersion(local)) {
    return { ok: false, update: false, reason: 'local_missing', local: local ?? null, remote: remote ?? null, repo };
  }
  if (error) {
    return { ok: false, update: false, reason: 'github_unavailable', local, remote: null, repo, error: String(error).slice(0, 200) };
  }
  const cmp = compareVersions(local, remote);
  if (cmp === null) {
    return { ok: false, update: false, reason: 'remote_invalid', local, remote: remote ?? null, repo };
  }
  const update = cmp < 0;
  return { ok: true, update, local, remote, repo };
}
