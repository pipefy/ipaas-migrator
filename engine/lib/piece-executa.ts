// Um step PIECE no canvas ainda pode não rodar: ação que a piece não tem,
// versão ~latest ou diferente da que o motor fixa, prop obrigatória vazia.
// TODO de operação sem mapa fica de fora — isso já vai para manual_revision.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildFlow } from './flow-builder.ts';
import { parseRecipe } from './parse-recipe.ts';
import { PIPEFY_PIECE_VERSION } from './pipefy-piece.ts';
import { SUBFLOW_PIECE_VERSION } from './subflow.ts';
import type { Kb, MapEntry, SlimOp, SlimPiece } from './types.ts';

const TODO_PIECE = 'TODO';
const PIPEFY_PIECE = '@activepieces/piece-pipefy';
const SUBFLOW_PIECE = '@activepieces/piece-subflows';

export interface PieceExecutaFinding {
  step: string;
  piece: string;
  op: string;
  kind: 'piece ausente' | 'acao ausente' | 'versao' | 'prop obrigatoria';
  detail: string;
}

function expectedVersion(pieceName: string, kbVersion: string | undefined): string | undefined {
  if (pieceName === PIPEFY_PIECE) return PIPEFY_PIECE_VERSION;
  if (pieceName === SUBFLOW_PIECE) return SUBFLOW_PIECE_VERSION;
  return kbVersion;
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  return typeof value === 'string' && value.trim() === '';
}

function walk(step: any, visit: (step: any) => void): void {
  if (!step || typeof step !== 'object') return;
  visit(step);
  walk(step.firstLoopAction, visit);
  walk(step.onFailureAction, visit);
  if (Array.isArray(step.children)) {
    for (const child of step.children) walk(child, visit);
  }
  const branches = step.continueOnFailureBranches;
  if (branches) {
    walk(branches.onSuccess, visit);
    walk(branches.onFailure, visit);
  }
  walk(step.nextAction, visit);
}

function operation(piece: SlimPiece, step: any): { kind: 'action' | 'trigger'; op: SlimOp | undefined; name: string } {
  if (step.type === 'PIECE_TRIGGER') {
    const name = String(step.settings?.triggerName ?? '');
    return { kind: 'trigger', name, op: piece.triggers.find((item) => item.name === name) };
  }
  const name = String(step.settings?.actionName ?? '');
  return { kind: 'action', name, op: piece.actions.find((item) => item.name === name) };
}

export function pieceExecuta(flow: { flows?: Array<{ trigger?: unknown }> }, kb: Kb): PieceExecutaFinding[] {
  const index = new Map(kb.pieces.map((piece) => [piece.name, piece]));
  const findings: PieceExecutaFinding[] = [];
  const trigger = flow.flows?.[0]?.trigger;
  walk(trigger, (step) => {
    if (step.type !== 'PIECE' && step.type !== 'PIECE_TRIGGER') return;
    if (step.skip) return;
    const pieceName = String(step.settings?.pieceName ?? '');
    if (!pieceName || pieceName === TODO_PIECE) return;

    const version = String(step.settings?.pieceVersion ?? '');
    const piece = index.get(pieceName);
    const opName = String(step.settings?.actionName ?? step.settings?.triggerName ?? '');
    const stepName = String(step.name ?? '');

    if (!piece) {
      findings.push({
        step: stepName,
        piece: pieceName,
        op: opName,
        kind: 'piece ausente',
        detail: `${stepName} ${pieceName} não está na KB`,
      });
      return;
    }

    const found = operation(piece, step);
    if (!found.op) {
      const pool = found.kind === 'trigger' ? piece.triggers : piece.actions;
      const names = pool.map((item) => item.name).join(', ') || '(vazio)';
      findings.push({
        step: stepName,
        piece: pieceName,
        op: found.name,
        kind: 'acao ausente',
        detail: `${stepName} ${found.kind} "${found.name}" não existe em ${pieceName}. Válidas: ${names}`,
      });
    }

    const want = expectedVersion(pieceName, piece.version);
    if (!version || version === '~latest' || (want && version !== want)) {
      findings.push({
        step: stepName,
        piece: pieceName,
        op: opName,
        kind: 'versao',
        detail: `${stepName} ${pieceName} em ${version || '(ausente)'}; o motor fixa ${want ?? 'a versão da KB'}`,
      });
    }

    // Props só valem quando a versão emitida é a da KB. Pipefy 0.2.4 e
    // subflows 0.7.0 estão à frente do snapshot; a lista required de lá
    // não é a piece que roda.
    if (found.op && version === piece.version) {
      const input = step.settings?.input ?? {};
      const missing = found.op.props
        .filter((prop) => prop.required && isEmpty(input[prop.name]))
        .map((prop) => prop.name);
      if (missing.length) {
        findings.push({
          step: stepName,
          piece: pieceName,
          op: found.name,
          kind: 'prop obrigatoria',
          detail: `${stepName} ${pieceName}/${found.name} sem ${missing.join(', ')}`,
        });
      }
    }
  });
  return findings;
}

export function checkRecipe(
  raw: unknown,
  file: string,
  merged: Record<string, MapEntry>,
  kb: Kb,
): PieceExecutaFinding[] {
  const parsed = parseRecipe(raw, file);
  const { flow } = buildFlow(parsed, merged, kb);
  return pieceExecuta(flow, kb);
}

export function recipeFiles(dirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.recipe.json')) files.push(join(dir, name));
    }
  }
  return files.sort();
}

export function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
