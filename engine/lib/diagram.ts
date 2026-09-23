// Workato ParsedRecipe -> Mermaid flowchart (reconstrucao visual da arvore `code`).

import type { ParsedRecipe, ParsedStep } from './types.ts';

export interface RecipeDiagram {
  type: 'recipe_diagram';
  mermaid: string;
}

interface Emitted {
  entry: string;
  exits: string[];
  /** Aresta rotulada ate o proximo irmao (ex. if sem else -> |nao|). */
  pending?: { from: string; label: string };
}

const EMPTY_MERMAID = 'flowchart TD\n  empty["Receita sem arvore code"]\n';

export function emptyDiagram(reason = 'Receita sem arvore code'): RecipeDiagram {
  return {
    type: 'recipe_diagram',
    mermaid: `flowchart TD\n  empty["${escapeLabel(reason)}"]\n`,
  };
}

export function recipeToDiagram(recipe: ParsedRecipe): RecipeDiagram {
  return { type: 'recipe_diagram', mermaid: toMermaid(recipe) };
}

export function toMermaid(recipe: ParsedRecipe): string {
  if (!recipe?.root) return EMPTY_MERMAID;
  const g = new Generator();
  const lines = [`%% ${escapeLabel(recipe.name)}`, 'flowchart TD'];
  g.emitStep(recipe.root, lines);
  return `${lines.join('\n')}\n`;
}

class Generator {
  private seq = 0;

  emitStep(step: ParsedStep, lines: string[]): Emitted {
    switch (step.keyword) {
      case 'if':
        return this.emitIf(step, lines);
      case 'foreach':
      case 'loop':
      case 'while':
      case 'repeat':
        return this.emitLoop(step, lines);
      case 'try':
        return this.emitTry(step, lines);
      case 'stop':
        return this.emitStop(step, lines);
      default:
        return this.emitPlain(step, lines);
    }
  }

  emitSequence(steps: ParsedStep[], lines: string[]): Emitted {
    if (!steps.length) return { entry: '', exits: [] };
    let firstEntry = '';
    let prev: Emitted | null = null;
    for (const step of steps) {
      const cur = this.emitStep(step, lines);
      if (!firstEntry) firstEntry = cur.entry;
      if (prev) this.link(prev, cur.entry, lines);
      prev = cur;
    }
    return { entry: firstEntry, exits: prev?.exits ?? [], pending: prev?.pending };
  }

  private link(prev: Emitted, nextEntry: string, lines: string[]): void {
    if (!nextEntry) return;
    for (const from of prev.exits) {
      lines.push(`  ${from} --> ${nextEntry}`);
    }
    if (prev.pending) {
      lines.push(`  ${prev.pending.from} -->|${prev.pending.label}| ${nextEntry}`);
    }
  }

  private emitPlain(step: ParsedStep, lines: string[]): Emitted {
    const id = this.idFor(step);
    const label = stepLabel(step);
    if (step.keyword === 'trigger') {
      lines.push(`  ${id}(["${label}"])`);
      const seq = this.emitSequence(step.children, lines);
      if (seq.entry) lines.push(`  ${id} --> ${seq.entry}`);
      return {
        entry: id,
        exits: seq.entry ? seq.exits : [id],
        pending: seq.pending,
      };
    }
    lines.push(`  ${id}["${label}"]`);
    if (step.children.length) {
      const seq = this.emitSequence(step.children, lines);
      if (seq.entry) lines.push(`  ${id} --> ${seq.entry}`);
      return { entry: id, exits: seq.exits.length ? seq.exits : [id], pending: seq.pending };
    }
    return { entry: id, exits: [id] };
  }

  private emitIf(step: ParsedStep, lines: string[]): Emitted {
    const id = this.idFor(step);
    lines.push(`  ${id}{"${stepLabel(step)}"}`);
    const { thenChildren, elseIfs, elseNode } = partitionIf(step);
    const thenSeq = this.emitSequence(thenChildren, lines);
    if (thenSeq.entry) lines.push(`  ${id} -->|sim| ${thenSeq.entry}`);
    const exits = [...thenSeq.exits];

    let current = id;
    let currentLabel = 'nao';

    for (const branch of elseIfs) {
      const bid = this.idFor(branch);
      lines.push(`  ${bid}{"${stepLabel(branch)}"}`);
      lines.push(`  ${current} -->|${currentLabel}| ${bid}`);
      const inner = this.emitSequence(branch.children, lines);
      if (inner.entry) lines.push(`  ${bid} -->|sim| ${inner.entry}`);
      exits.push(...inner.exits);
      current = bid;
      currentLabel = 'nao';
    }

    if (elseNode) {
      const elseSeq = this.emitSequence(elseNode.children, lines);
      if (elseSeq.entry) lines.push(`  ${current} -->|${currentLabel}| ${elseSeq.entry}`);
      exits.push(...elseSeq.exits);
      return { entry: id, exits };
    }

    return { entry: id, exits, pending: { from: current, label: currentLabel } };
  }

  private emitLoop(step: ParsedStep, lines: string[]): Emitted {
    const id = this.idFor(step);
    const title = loopTitle(step);
    lines.push(`  subgraph ${id} ["${title}"]`);
    this.emitSequence(step.children, lines);
    lines.push('  end');
    return { entry: id, exits: [id] };
  }

  private emitTry(step: ParsedStep, lines: string[]): Emitted {
    const id = this.idFor(step);
    const body = step.children.filter((c) => c.keyword !== 'catch');
    const catches = step.children.filter((c) => c.keyword === 'catch');
    lines.push(`  subgraph ${id} ["${escapeLabel(step.comment || 'try')}"]`);
    this.emitSequence(body, lines);
    lines.push('  end');
    const exits = [id];
    for (const c of catches) {
      const cid = this.idFor(c);
      lines.push(`  subgraph ${cid} ["${escapeLabel(c.comment || 'catch')}"]`);
      this.emitSequence(c.children, lines);
      lines.push('  end');
      lines.push(`  ${id} -->|erro| ${cid}`);
      exits.push(cid);
    }
    return { entry: id, exits };
  }

  private emitStop(step: ParsedStep, lines: string[]): Emitted {
    const id = this.idFor(step);
    lines.push(`  ${id}((("${escapeLabel(stepLabel(step))}")))`);
    return { entry: id, exits: [] };
  }

  private idFor(step: ParsedStep): string {
    if (step.number != null && Number.isFinite(step.number)) return `n${step.number}`;
    return `s${this.seq++}`;
  }
}

function partitionIf(step: ParsedStep): {
  thenChildren: ParsedStep[];
  elseIfs: ParsedStep[];
  elseNode?: ParsedStep;
} {
  const thenChildren: ParsedStep[] = [];
  const elseIfs: ParsedStep[] = [];
  let elseNode: ParsedStep | undefined;
  let branched = false;
  for (const child of step.children) {
    if (child.keyword === 'else') {
      elseNode = child;
      branched = true;
      continue;
    }
    if (child.keyword === 'elseif' || child.keyword === 'elsif') {
      elseIfs.push(child);
      branched = true;
      continue;
    }
    if (!branched) thenChildren.push(child);
  }
  return { thenChildren, elseIfs, elseNode };
}

function loopTitle(step: ParsedStep): string {
  const base = step.comment || step.keyword;
  if (!step.source) return escapeLabel(base);
  return escapeLabel(`${base} ${shortText(step.source, 40)}`);
}

function stepLabel(step: ParsedStep): string {
  const num = step.number != null ? `#${step.number} ` : '';
  const op =
    step.opKey ||
    [step.provider, step.name].filter(Boolean).join('/') ||
    step.keyword;
  const parts = [`${num}${op}`];
  if (step.comment) parts.push(step.comment);
  if (step.keyword === 'if' || step.keyword === 'elseif' || step.keyword === 'elsif') {
    const cond = shortCondition(step);
    if (cond) parts.push(cond);
  }
  return escapeLabel(parts.join(' — '));
}

function shortCondition(step: ParsedStep): string {
  const raw = step.input?.conditions;
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const join = String(step.input?.operand ?? 'and');
  return raw
    .map((c: { lhs?: string; operand?: string; rhs?: string }) => {
      const lhs = shortText(String(c.lhs ?? ''), 36);
      const rhs = c.rhs ? ` ${shortText(String(c.rhs), 20)}` : '';
      return `${lhs} ${c.operand ?? ''}${rhs}`.trim();
    })
    .join(` ${join} `);
}

function shortText(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function escapeLabel(s: string): string {
  return s
    .replace(/\\/g, '/')
    .replace(/"/g, "'")
    .replace(/[[\]{}|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}
