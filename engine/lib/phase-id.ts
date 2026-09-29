// Workato grava o formulário inicial como phase_id "0". O id da fase está no
// schema de saída (fields_by_phase), no passo que leu o mesmo pipe.
import type { PipePhase } from './types.ts';

const PHASE_ID = /^\d+$/;

function phasesInSchema(node: unknown, found: { label: string; phaseId: string }[]): void {
  if (Array.isArray(node)) {
    for (const item of node) phasesInSchema(item, found);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.name === 'fields_by_phase' && Array.isArray(obj.properties)) {
    for (const prop of obj.properties) {
      if (!prop || typeof prop !== 'object') continue;
      const child = prop as Record<string, unknown>;
      const phaseId = typeof child.name === 'string' ? child.name : '';
      const label = typeof child.label === 'string' ? child.label.trim() : '';
      if (child.type === 'object' && PHASE_ID.test(phaseId) && phaseId !== '0' && label) {
        found.push({ phaseId, label });
      }
    }
  }
  for (const value of Object.values(obj)) phasesInSchema(value, found);
}

/** Varre a árvore `code` e associa cada fase ao pipe do passo que tem o schema. */
export function collectPipePhases(code: unknown): PipePhase[] {
  const acc: PipePhase[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const step = node as Record<string, any>;
    const rawPipe = step.input?.pipe_id;
    const pipeId =
      typeof rawPipe === 'string' || typeof rawPipe === 'number' ? String(rawPipe).trim() : '';
    if (pipeId && !pipeId.includes('#{') && step.extended_output_schema) {
      const found: { label: string; phaseId: string }[] = [];
      phasesInSchema(step.extended_output_schema, found);
      for (const phase of found) {
        const key = `${pipeId}\0${phase.label}\0${phase.phaseId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        acc.push({ pipeId, label: phase.label, phaseId: phase.phaseId });
      }
    }
    if (Array.isArray(step.block)) visit(step.block);
  };

  visit(code);
  return acc;
}

/**
 * Troca `phase_id` "0" pelo id cujo rótulo bate com o dropdown, no mesmo pipe.
 * Sem um único match, o input segue como veio.
 */
export function resolveZeroPhaseInput(
  input: Record<string, any>,
  phasePickLabel: string | undefined,
  catalog: PipePhase[],
): Record<string, any> {
  const phase = input.phase_id;
  if (phase !== '0' && phase !== 0) return input;
  const label = phasePickLabel?.trim() ?? '';
  const rawPipe = input.pipe_id;
  const pipeId =
    typeof rawPipe === 'string' || typeof rawPipe === 'number' ? String(rawPipe).trim() : '';
  if (!label || !pipeId || pipeId.includes('#{')) return input;
  const ids = [
    ...new Set(
      catalog.filter((entry) => entry.pipeId === pipeId && entry.label === label).map((entry) => entry.phaseId),
    ),
  ];
  if (ids.length !== 1) return input;
  return { ...input, phase_id: ids[0]! };
}
