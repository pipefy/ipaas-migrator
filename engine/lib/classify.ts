// Classifica cada operacao da receita e sugere candidatos da KB p/ nao-mapeadas.
import { lookupMap } from './collapse.ts';
import type { Kb, MapEntry, OpClassification } from './types.ts';

/** tokens uteis do opKey (ignora ids longos do provider). */
function tokens(opKey: string): string[] {
  const opName = opKey.split('/')[1] ?? opKey;
  return opName
    .toLowerCase()
    .split(/[_\s]+/)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t));
}

/** score simples de similaridade por tokens compartilhados. */
function scoreOp(opTokens: string[], candidateName: string): number {
  const c = candidateName.toLowerCase();
  let s = 0;
  for (const t of opTokens) if (c.includes(t)) s += 1;
  return s;
}

export function suggestCandidates(
  opKey: string,
  kb: Kb,
  limit = 5,
): OpClassification['suggestions'] {
  const opTokens = tokens(opKey);
  if (!opTokens.length) return [];
  const out: NonNullable<OpClassification['suggestions']> = [];
  for (const p of kb.pieces) {
    for (const a of p.actions) {
      const score = scoreOp(opTokens, a.name) + scoreOp(opTokens, p.displayName);
      if (score > 0) out.push({ piece: p.name, op: a.name, kind: 'action', score });
    }
    for (const t of p.triggers) {
      const score = scoreOp(opTokens, t.name) + scoreOp(opTokens, p.displayName);
      if (score > 0) out.push({ piece: p.name, op: t.name, kind: 'trigger', score });
    }
  }
  // prioriza pieces custom/pipefy/slack quando empatar
  out.sort((a, b) => b.score - a.score || a.piece.localeCompare(b.piece));
  return out.slice(0, limit);
}

export function classifyOps(
  opCounts: Record<string, number>,
  merged: Record<string, MapEntry>,
  kb: Kb,
): OpClassification[] {
  return Object.entries(opCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([opKey, count]) => {
      const entry = lookupMap(merged, opKey);
      if (!entry) {
        return {
          opKey,
          count,
          status: 'unmapped' as const,
          suggestions: suggestCandidates(opKey, kb),
        };
      }
      let status: OpClassification['status'] = 'mapped';
      if (entry.manual) status = 'manual';
      else if (!entry.target && entry.builtin) status = 'builtin';
      return {
        opKey,
        count,
        status,
        target: entry.target ?? null,
        builtin: entry.builtin,
        difficulty: entry.difficulty,
        notes: entry.notes,
      };
    });
}
