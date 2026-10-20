// Notas adesivas no flow.json a partir do transporte.json.
// Só escreve o flow. Não chama Pipefy, não edita mapa, KB nem engine.

export const NOTE_X = 312;
export const NOTE_STEP_STRIDE = 120;
export const NOTE_STAMP = '2020-01-01T00:00:00.000Z';

const PHRASES = {
  pt: {
    'valid:false': 'Um passo ficou com um campo obrigatório em branco.',
    'piece TODO': 'Não achei um equivalente direto para uma ação do Workato.',
    'action faltando': 'Uma ação do Workato não tem passo correspondente.',
    'TODO_pill': 'Um campo dinâmico não foi convertido.',
    'TODO_FORMULA': 'Uma fórmula não foi convertida.',
    'AP-MIGRATION-TODO': 'Um passo com código precisa de revisão.',
    'HTTP pad': 'Uma chamada HTTP ficou incompleta.',
    'pill de erro': 'A mensagem de erro de um passo não veio.',
    python: 'Um trecho em Python não virou código.',
    manual_revision: 'O motor marcou esta receita para revisão manual antes de publicar.',
    other: 'Um passo precisa de ajuste antes do teste.',
    title: 'Revisar antes do teste',
    doThis: 'Confira este passo no Pipefy antes de publicar.',
  },
  en: {
    'valid:false': 'A step was left with a required field blank.',
    'piece TODO': 'I could not find a direct match for a Workato action.',
    'action faltando': 'A Workato action has no matching step.',
    'TODO_pill': 'A dynamic field was not converted.',
    'TODO_FORMULA': 'A formula was not converted.',
    'AP-MIGRATION-TODO': 'A step with code needs a review.',
    'HTTP pad': 'An HTTP call was left incomplete.',
    'pill de erro': "A step's error message did not come through.",
    python: 'A Python snippet did not become code.',
    manual_revision: 'The engine flagged this recipe for manual review before publish.',
    other: 'A step needs a fix before the test.',
    title: 'Review before testing',
    doThis: 'Check this step in Pipefy before you publish.',
  },
  es: {
    'valid:false': 'Un paso quedó con un campo obligatorio en blanco.',
    'piece TODO': 'No encontré un equivalente directo para una acción de Workato.',
    'action faltando': 'Una acción de Workato no tiene paso correspondiente.',
    'TODO_pill': 'Un campo dinámico no se convirtió.',
    'TODO_FORMULA': 'Una fórmula no se convirtió.',
    'AP-MIGRATION-TODO': 'Un paso con código necesita revisión.',
    'HTTP pad': 'Una llamada HTTP quedó incompleta.',
    'pill de erro': 'El mensaje de error de un paso no llegó.',
    python: 'Un fragmento en Python no se volvió código.',
    manual_revision: 'El motor marcó esta receta para revisión manual antes de publicar.',
    other: 'Un paso necesita un ajuste antes de la prueba.',
    title: 'Revisar antes de probar',
    doThis: 'Revisa este paso en Pipefy antes de publicar.',
  },
};

const BANNED = [/active\s*pieces/i, /\bdatapill\b/i, /AP-MIGRATION-TODO/, /\bschema\b/i];

export function phrasesFor(lang) {
  return PHRASES[lang] ?? PHRASES.pt;
}

export function phraseFor(kind, lang) {
  const table = phrasesFor(lang);
  return table[kind] ?? table.other;
}

/** Tira e-mail, id interno, caminho e nome de operação do texto que o cliente vê. */
export function publicDetail(detail) {
  return String(detail ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\b[0-9a-f]{8,}\b/gi, '')
    .replace(/\b[a-z0-9_]+\/[a-z0-9_]+\b/gi, '')
    .replace(/ontologias?\b/gi, '')
    .replace(/(?:^|\s)\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function noteContent(finding, lang) {
  const table = phrasesFor(lang);
  const what = phraseFor(finding.kind, lang);
  const where = publicDetail(finding.detail)
    .replace(/AP-MIGRATION-TODO/g, '')
    .replace(/TODO_[A-Za-z]+/g, '')
    .replace(/active\s*pieces/gi, '')
    .replace(/\bpiece\b/gi, '')
    .replace(/\bdatapill\b/gi, '')
    .replace(/\bTODO\b/g, '')
    .replace(/valid:false/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const body = where ? `${what}\n\n${where}` : what;
  return `**${table.title}**\n\n${body}\n\n${table.doThis}`;
}

function walk(step, visit) {
  if (!step || typeof step !== 'object') return;
  visit(step);
  for (const key of ['nextAction', 'firstLoopAction', 'onFailureAction', 'onSuccessAction']) {
    walk(step[key], visit);
  }
  for (const child of step.children ?? []) walk(child, visit);
  for (const branch of step.branches ?? []) walk(branch, visit);
  const forks = step.continueOnFailureBranches;
  if (forks) {
    walk(forks.onSuccess, visit);
    walk(forks.onFailure, visit);
  }
}

function stepNames(flow) {
  const names = [];
  walk(flow?.flows?.[0]?.trigger, (step) => {
    if (step.name) names.push(step.name);
  });
  return names;
}

function depthOf(flow, name) {
  const names = stepNames(flow);
  const at = names.indexOf(name);
  return at === -1 ? names.length || 1 : at + 1;
}

function relevant(findings) {
  return (findings ?? []).filter((item) => item && item.severity !== 'info');
}

export function annotateFlow(flow, report, lang = 'pt') {
  const findings = relevant(report?.findings);
  const names = stepNames(flow);
  const triggerName = names[0] ?? 'trigger';
  const notes = Array.isArray(flow?.flows?.[0]?.notes) ? [...flow.flows[0].notes] : [];
  const existing = new Set(notes.map((note) => note.id));
  let added = 0;

  findings.forEach((finding, index) => {
    const step = names.includes(finding.step) ? finding.step : triggerName;
    const id = `review_validacao_${step}_${index}`;
    if (existing.has(id)) return;
    const content = noteContent(finding, lang);
    notes.push({
      id,
      content,
      ownerId: null,
      color: 'yellow',
      position: { x: NOTE_X, y: depthOf(flow, step) * NOTE_STEP_STRIDE + notes.length * 220 },
      size: { width: 280, height: content.length > 280 ? 360 : 240 },
      createdAt: NOTE_STAMP,
      updatedAt: NOTE_STAMP,
    });
    existing.add(id);
    added += 1;
  });

  if (flow?.flows?.[0]) flow.flows[0].notes = notes;
  return { flow, added, notes: notes.length };
}
