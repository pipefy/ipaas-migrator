// Parser da receita Workato: arvore `code` -> ParsedRecipe.
import { basename } from 'node:path';
import type { FormulaHit, ParsedRecipe, ParsedStep } from './types.ts';
import { analyzeFormula } from './datapills.ts';
import { parseRubySleep } from './delay.ts';

function walkStrings(node: any, visit: (s: string) => void): void {
  if (typeof node === 'string') visit(node);
  else if (Array.isArray(node)) node.forEach((n) => walkStrings(n, visit));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => walkStrings(v, visit));
}

function parseStep(node: any): ParsedStep {
  const provider: string | undefined = node.provider;
  const name: string | undefined = node.name;
  const step: ParsedStep = {
    number: node.number,
    as: node.as,
    provider,
    name,
    keyword: node.keyword ?? 'action',
    // Passo desativado na receita: nao executa. Sem ler isso, a migracao
    // transformava passo desligado em passo ativo.
    skip: node.skip === true,
    input: node.input ?? {},
    filter: node.filter && typeof node.filter === 'object' ? node.filter : undefined,
    source: typeof node.source === 'string' ? node.source : undefined,
    comment: node.comment,
    children: Array.isArray(node.block) ? node.block.map(parseStep) : [],
  };
  if (provider && name && (step.keyword === 'action' || step.keyword === 'trigger')) {
    step.opKey = `${provider}/${name}`;
  }
  return step;
}

function collect(
  step: ParsedStep,
  opCounts: Record<string, number>,
  acc: { steps: number },
): void {
  acc.steps++;
  if (step.opKey) opCounts[step.opKey] = (opCounts[step.opKey] ?? 0) + 1;
  step.children.forEach((c) => collect(c, opCounts, acc));
}

/** Custom Ruby que exige tradução para JS. Corpo que é só sleep vira delayFor, não CODE. */
function hasTranslatableRuby(step: ParsedStep): boolean {
  if (step.opKey?.endsWith('/invoke_custom_ruby_code') && !parseRubySleep(step.input?.code)) {
    return true;
  }
  return step.children.some(hasTranslatableRuby);
}

export function parseRecipe(json: any, file = 'recipe.json'): ParsedRecipe {
  // Workato's Developer API wraps `code` as a JSON string, while ZIP exports
  // already expose it as an object. Normalize both formats here so every
  // command can consume either source.
  const rawCode = json.code ?? {};
  const code = typeof rawCode === 'string' ? JSON.parse(rawCode) : rawCode;
  const root = parseStep(code);
  const opCounts: Record<string, number> = {};
  const acc = { steps: 0 };
  collect(root, opCounts, acc);

  // conexoes
  const connections: string[] = [];
  const rawConfig = json.config ?? [];
  const config = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
  for (const c of Array.isArray(config) ? config : []) {
    const zip = c?.account_id?.zip_name;
    if (zip) connections.push(String(zip).replace(/^Connections\//, ''));
  }

  // formulas (varre todas as strings da receita)
  const formulas: FormulaHit[] = [];
  const seen = new Set<string>();
  walkStrings(code, (s) => {
    const f = analyzeFormula(s);
    if (f && !seen.has(f.raw)) {
      seen.add(f.raw);
      formulas.push(f);
    }
  });

  const hasRuby = hasTranslatableRuby(root) || formulas.some((f) => f.needsCode);

  return {
    file: basename(file),
    name: json.name ?? '(sem nome)',
    workatoId: json.id != null && String(json.id).trim() !== '' ? String(json.id) : undefined,
    description: json.description,
    root,
    connections: [...new Set(connections)],
    opCounts,
    formulas,
    hasRuby,
    stepCount: acc.steps,
  };
}

/** Trigger Workato sem provider/name — receita em branco, sem piece para importar. */
export function isEmptyWorkatoTrigger(root: ParsedStep): boolean {
  return !root.provider && !root.name && !root.opKey;
}
