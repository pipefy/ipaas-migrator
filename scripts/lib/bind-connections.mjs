// Cruza slots Workato + conexoes iPaaS ACTIVE e injeta
// input.auth = "{{connections['<externalId>']}}" nos steps do flow.
// Nao cria conexao. Nao publica.

import { parseRecipeProfile, slotsIpaas } from './recipe-profile.mjs';
import {
  authId,
  connKey,
  findConnection,
  hintMatchesSlot,
  hintsFromArgv,
  mergeHints,
  parseConnectionHints,
  parseConnectionIdsArg,
  syntheticConnection,
} from './connection-hints.mjs';

export {
  mergeHints,
  parseConnectionHints,
  parseConnectionIdsArg,
  hintsFromArgv,
};

export const NO_AUTH_PIECES = new Set([
  '@activepieces/piece-webhook',
  '@activepieces/piece-schedule',
  '@activepieces/piece-http',
  '@activepieces/piece-delay',
  '@activepieces/piece-store',
  '@activepieces/piece-data-mapper',
  '@activepieces/piece-text-helper',
  '@activepieces/piece-date-helper',
  '@activepieces/piece-datetime-helper',
  '@activepieces/piece-json',
  '@activepieces/piece-csv',
  '@activepieces/piece-xml',
  '@activepieces/piece-file-helper',
  '@activepieces/piece-math-helper',
  '@activepieces/piece-code',
]);

const CHILD_KEYS = ['nextAction', 'firstLoopAction', 'onFailureAction'];

export function slug(label) {
  return String(label)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'conn';
}

export function authRef(externalId) {
  return `{{connections['${externalId}']}}`;
}

export function listConnections(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.connections)) return raw.connections;
  return [];
}

export function listPlaceholders(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.placeholders)) return raw.placeholders;
  return [];
}

export function walkPieceSteps(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (node.type === 'PIECE' || node.type === 'PIECE_TRIGGER') acc.push(node);
  for (const k of CHILD_KEYS) if (node[k]) walkPieceSteps(node[k], acc);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkPieceSteps(child, acc);
  }
  return acc;
}

function needsAuth(pieceName) {
  return Boolean(pieceName) && !NO_AUTH_PIECES.has(pieceName);
}

function stableIds(slot, pipeId) {
  if (slot.kind === 'pipefy' || slot.requireServiceAccount) {
    return pipeId ? [`pipefy-${pipeId}-sa`] : [];
  }
  const accounts = (slot.workatoAccounts ?? []).map(String);
  if (!accounts.length) return [];
  return accounts.map((account) => `${slug(slot.label)}-${account}`);
}

function isUsed(used, conn) {
  return connectionKeysForUsed(conn).some((k) => used.has(k));
}

function connectionKeysForUsed(conn) {
  return [...new Set([connKey(conn), conn?.id, conn?.externalId].filter(Boolean).map(String))];
}

function markUsed(used, conn) {
  for (const k of connectionKeysForUsed(conn)) used.add(k);
}

function pickGiven(slot, hints, connections, used, allowSynthetic) {
  const picked = [];
  const need = Math.max(1, slot.quantity ?? 1);
  const take = (conn) => {
    if (!conn || isUsed(used, conn) || picked.length >= need) return false;
    picked.push(conn);
    markUsed(used, conn);
    return true;
  };

  for (const hint of hints) {
    if (picked.length >= need) break;
    if (hint.piece || hint.label) {
      if (!hintMatchesSlot(hint, slot)) continue;
    } else {
      continue;
    }
    const found = findConnection(connections, hint.id);
    if (found) {
      if (found.pieceName && found.pieceName !== slot.piece) continue;
      if (found.status && found.status !== 'ACTIVE' && !allowSynthetic) continue;
      take(found.status === 'ACTIVE' || allowSynthetic ? found : null);
      continue;
    }
    if (allowSynthetic) take(syntheticConnection(hint, slot));
  }

  if (picked.length >= need) return picked;

  for (const hint of hints) {
    if (picked.length >= need) break;
    if (hint.piece || hint.label) continue;
    const found = findConnection(connections, hint.id);
    if (found) {
      if (found.pieceName && found.pieceName !== slot.piece) continue;
      if (found.status && found.status !== 'ACTIVE' && !allowSynthetic) continue;
      take(found);
      continue;
    }
    if (allowSynthetic) take(syntheticConnection(hint, slot));
  }

  return picked;
}

function pickForSlot(slot, connections, placeholders, pipeId, used, hints, allowSynthetic) {
  const piece = slot.piece;
  if (!piece) {
    return { picked: [], missing: slot.quantity ?? 1, reason: 'piece_desconhecida' };
  }
  const preferred = new Set([
    ...stableIds(slot, pipeId),
    ...placeholders.filter((p) => p.piece === piece && p.externalId).map((p) => p.externalId),
  ]);
  const active = connections.filter(
    (c) => c.pieceName === piece && c.status === 'ACTIVE' && !isUsed(used, c),
  );
  const picked = [];
  const need = Math.max(1, slot.quantity ?? 1);

  const take = (conn) => {
    if (!conn || isUsed(used, conn) || picked.length >= need) return;
    picked.push(conn);
    markUsed(used, conn);
  };

  for (const conn of pickGiven(slot, hints, connections, used, allowSynthetic)) {
    if (picked.length >= need) break;
    if (!picked.includes(conn)) picked.push(conn);
  }

  for (const id of preferred) {
    take(active.find((c) => c.externalId === id || c.id === id));
  }

  if (slot.kind === 'pipefy' || slot.requireServiceAccount) {
    for (const c of active) {
      if (/service account/i.test(c.displayName ?? '')) take(c);
    }
  }

  for (const c of active) take(c);

  return {
    picked,
    missing: Math.max(0, need - picked.length),
    reason: picked.length ? null : 'sem_active',
  };
}

function slotsFromFlow(steps, existing) {
  const covered = new Set(existing.map((s) => s.piece).filter(Boolean));
  const extra = [];
  const seen = new Set();
  for (const step of steps) {
    const piece = step.settings?.pieceName;
    if (!needsAuth(piece) || covered.has(piece) || seen.has(piece)) continue;
    seen.add(piece);
    extra.push({
      kind: piece.includes('piece-pipefy') ? 'pipefy' : 'external',
      label: piece.replace(/^@activepieces\/piece-/, ''),
      piece,
      workatoAccounts: [],
      quantity: 1,
      requireServiceAccount: piece.includes('piece-pipefy'),
      fromFlow: true,
    });
  }
  return extra;
}

export function planBindings({
  recipe,
  flow,
  connections: connectionsRaw,
  placeholders: placeholdersRaw,
  pipeId,
  hints,
  allowSynthetic = false,
}) {
  const profile = parseRecipeProfile(recipe);
  const slots = slotsIpaas(profile);
  const connections = listConnections(connectionsRaw);
  const placeholders = listPlaceholders(placeholdersRaw);
  const givenFromPlaceholders = placeholders
    .filter((p) => p.action === 'given' && (p.externalId || p.id))
    .map((p) => ({
      id: String(p.externalId || p.id),
      label: p.label ?? null,
      piece: p.piece ?? null,
    }));
  const given = mergeHints(hints, givenFromPlaceholders);
  const trigger = flow?.flows?.[0]?.trigger ?? flow?.trigger;
  const steps = flow ? walkPieceSteps(trigger) : [];
  const allSlots = [...slots, ...slotsFromFlow(steps, slots)];

  const used = new Set();
  const bindings = [];
  const missing = [];

  for (const slot of allSlots) {
    const { picked, missing: lack, reason } = pickForSlot(
      slot, connections, placeholders, pipeId, used, given, allowSynthetic,
    );
    if (lack > 0 || !picked.length) {
      missing.push({
        label: slot.label,
        piece: slot.piece,
        workatoAccounts: slot.workatoAccounts ?? [],
        need: lack || 1,
        reason: reason ?? 'quantidade',
      });
      continue;
    }
    const conn = picked[0];
    const stepNames = steps
      .filter((s) => s.settings?.pieceName === slot.piece)
      .map((s) => s.name)
      .filter(Boolean);
    bindings.push({
      label: slot.label,
      piece: slot.piece,
      workatoAccounts: slot.workatoAccounts ?? [],
      externalId: authId(conn),
      displayName: conn.displayName ?? authId(conn),
      status: conn.status,
      given: Boolean(conn.synthetic || given.some((h) => connectionKeysForUsed(conn).includes(h.id))),
      synthetic: Boolean(conn.synthetic),
      steps: stepNames,
      extra: picked.slice(1).map((c) => ({
        externalId: authId(c),
        displayName: c.displayName,
      })),
    });
  }

  const skipped = steps
    .filter((s) => !needsAuth(s.settings?.pieceName))
    .map((s) => ({ name: s.name, piece: s.settings?.pieceName, reason: 'sem_auth' }));

  const unbound = steps.filter((s) => {
    const piece = s.settings?.pieceName;
    return needsAuth(piece) && !bindings.some((b) => b.piece === piece);
  }).map((s) => ({ name: s.name, piece: s.settings?.pieceName }));

  for (const u of unbound) {
    if (!missing.some((m) => m.piece === u.piece)) {
      missing.push({
        label: u.piece,
        piece: u.piece,
        workatoAccounts: [],
        need: 1,
        reason: 'step_sem_slot',
      });
    }
  }

  return {
    ready: missing.length === 0,
    recipe: profile.recipe,
    recipeId: profile.recipeId,
    bindings,
    missing,
    skipped,
    httpConns: profile.httpConns,
    given,
  };
}

export function applyBindings(flow, bindings) {
  const byPiece = new Map(bindings.map((b) => [b.piece, b]));
  const trigger = flow?.flows?.[0]?.trigger ?? flow?.trigger;
  const applied = [];
  for (const step of walkPieceSteps(trigger)) {
    const piece = step.settings?.pieceName;
    const bind = byPiece.get(piece);
    if (!bind || !needsAuth(piece)) continue;
    if (!step.settings.input || typeof step.settings.input !== 'object') {
      step.settings.input = {};
    }
    const externalId = authId(bind, bind.externalId);
    step.settings.input.auth = authRef(externalId);
    if (!step.settings.propertySettings || typeof step.settings.propertySettings !== 'object') {
      step.settings.propertySettings = {};
    }
    step.settings.propertySettings.auth = { type: 'MANUAL' };
    applied.push({ name: step.name, piece, externalId });
  }
  return { flow, applied };
}
