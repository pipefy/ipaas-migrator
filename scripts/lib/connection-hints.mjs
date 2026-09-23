// Extrai IDs de conexão iPaaS do prompt (`Conexão: <id>`) e cruza
// com a listagem (id ou externalId). Sem credencial.

import { IPAAS_PIECE } from './recipe-profile.mjs';

export const HINT_KEYWORD_RE = /Conex(?:[aã]o|[oóõ]es)|Conexi[oó]n(?:es)?|Connections?/i;

const LABEL_TO_PIECE = {
  pipefy: '@activepieces/piece-pipefy',
  sa: '@activepieces/piece-pipefy',
  'service account': '@activepieces/piece-pipefy',
  slack: '@activepieces/piece-slack',
  openai: '@activepieces/piece-openai',
  'open ai': '@activepieces/piece-openai',
  sheets: '@activepieces/piece-google-sheets',
  'google sheets': '@activepieces/piece-google-sheets',
  bigquery: '@activepieces/piece-google-bigquery',
  'big query': '@activepieces/piece-google-bigquery',
  'google bigquery': '@activepieces/piece-google-bigquery',
};

for (const [label, piece] of Object.entries(IPAAS_PIECE)) {
  LABEL_TO_PIECE[norm(label)] = piece;
}

export function norm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function pieceFromLabel(label) {
  const n = norm(label);
  if (!n) return null;
  if (LABEL_TO_PIECE[n]) return LABEL_TO_PIECE[n];
  if (n.includes('pipefy') || n.includes('service account')) {
    return '@activepieces/piece-pipefy';
  }
  for (const [key, piece] of Object.entries(LABEL_TO_PIECE)) {
    if (n.includes(key) || key.includes(n)) return piece;
  }
  return null;
}

export function cleanConnectionId(raw) {
  let id = String(raw ?? '').trim();
  id = id.replace(/^[\s`'""*[_<(]+/, '').replace(/[\s`'""*\])>.,;]+$/, '');
  if (!id || /^https?:\/\//i.test(id)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{4,80}$/.test(id)) return null;
  return id;
}

function splitIds(rest) {
  return String(rest)
    .split(/\s*(?:,|;|\be\b|\band\b|\by\b)\s*/i)
    .map(cleanConnectionId)
    .filter(Boolean);
}

function pushHint(acc, seen, hint) {
  const key = `${hint.piece ?? ''}::${hint.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  acc.push(hint);
}

/** `Conexão: <id>` / `Connection Slack: <id>` / `Conexões: a, b`. */
export function parseConnectionHints(text) {
  const hints = [];
  const seen = new Set();
  if (!text) return hints;
  const re = new RegExp(
    `(?:^|[\\n\\r])\\s*(?:[-*]\\s*)?(?:\\*\\*)?(${HINT_KEYWORD_RE.source})\\s*([^:\\n]*?)\\s*:\\s*([^\\n]+)`,
    'gi',
  );
  let m;
  while ((m = re.exec(String(text))) !== null) {
    const label = String(m[2] ?? '').replace(/\*+/g, '').trim();
    const piece = pieceFromLabel(label);
    for (const id of splitIds(m[3])) {
      pushHint(hints, seen, {
        id,
        label: label || null,
        piece,
      });
    }
  }
  return hints;
}

/** CLI: `id1,id2` ou `Pipefy:id1,Slack:id2`. */
export function parseConnectionIdsArg(raw) {
  const hints = [];
  const seen = new Set();
  if (!raw) return hints;
  for (const part of String(raw).split(/[,\s]+/).filter(Boolean)) {
    const labeled = part.match(/^([^:]+):(.+)$/);
    if (labeled && !/^\d+$/.test(labeled[1])) {
      const label = labeled[1].trim();
      const id = cleanConnectionId(labeled[2]);
      if (!id) continue;
      pushHint(hints, seen, { id, label: label || null, piece: pieceFromLabel(label) });
      continue;
    }
    const id = cleanConnectionId(part);
    if (!id) continue;
    pushHint(hints, seen, { id, label: null, piece: null });
  }
  return hints;
}

export function mergeHints(...lists) {
  const acc = [];
  const seen = new Set();
  for (const list of lists) {
    for (const hint of list ?? []) {
      if (!hint?.id) continue;
      pushHint(acc, seen, {
        id: String(hint.id),
        label: hint.label ?? null,
        piece: hint.piece ?? pieceFromLabel(hint.label) ?? null,
      });
    }
  }
  return acc;
}

export function connectionKeys(conn) {
  return [...new Set(
    [conn?.externalId, conn?.external_id, conn?.id]
      .filter((v) => v != null && String(v).trim() !== '')
      .map(String),
  )];
}

export function connKey(conn) {
  return String(conn?.externalId || conn?.id || '');
}

export function findConnection(connections, givenId) {
  const want = String(givenId);
  return (Array.isArray(connections) ? connections : []).find((c) => connectionKeys(c).includes(want)) ?? null;
}

export function authId(conn, fallback = null) {
  return String(conn?.externalId || conn?.id || fallback || '');
}

export function hintMatchesSlot(hint, slot) {
  if (!slot?.piece) return false;
  if (hint.piece) return hint.piece === slot.piece;
  if (hint.label) {
    const n = norm(hint.label);
    return n === norm(slot.label) || n === norm(slot.kind) || String(slot.piece).includes(n.replace(/\s+/g, '-'));
  }
  return true;
}

export function syntheticConnection(hint, slot) {
  return {
    id: hint.id,
    externalId: hint.id,
    pieceName: slot.piece,
    status: 'ACTIVE',
    displayName: hint.label || hint.id,
    synthetic: true,
  };
}

export function hintsFromArgv(argv = process.argv) {
  const parts = [];
  let text = '';
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--connection-ids' || argv[i] === '--connection-id') && argv[i + 1]) {
      parts.push(argv[++i]);
      continue;
    }
    if (argv[i] === '--hints-text' && argv[i + 1]) {
      text += `\n${argv[++i]}`;
    }
  }
  return mergeHints(parseConnectionIdsArg(parts.join(',')), parseConnectionHints(text));
}
