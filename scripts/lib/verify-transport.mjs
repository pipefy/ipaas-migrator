// Audita o flow iPaaS transportado contra a receita Workato.
// Nao chama Pipefy. Nao edita mapa/KB.
import { NO_AUTH_PIECES } from './bind-connections.mjs';
import { PIPEFY_PIECE_VERSION } from '../../engine/lib/pipefy-piece.ts';
import { SUBFLOW_PIECE_VERSION } from '../../engine/lib/subflow.ts';
import { indexVariables, isEmptyListDeclare } from '../../engine/lib/variables.ts';

const CONNECTOR_SUFFIX = /_connector_\d+(?:_\d+)?$/;

const COLLAPSE_RULES = [
  [/new_connector_6_connector_186728|pipefy|upload_attchments?|upload_attachment/i, 'pipefy'],
  [/new_connector_4_connector_186728_1620754526/i, 'whatsapp'],
  [/new_connector_4_connector_186728_1623952876/i, 'pdf'],
  [/new_connector_4_connector_186728_1617038418/i, 'custom_jobs'],
  [/new_connector_21_connector_186728/i, 'omie'],
  [/new_connector_22_connector_186728/i, 'lead'],
  [/^slack/i, 'slack'],
  [/^rest/i, 'rest'],
  [/google_sheets/i, 'google_sheets'],
  [/google_docs/i, 'google_docs'],
  [/google_forms/i, 'google_forms'],
  [/google_big_?query/i, 'google_bigquery'],
  [/google_drive/i, 'google_drive'],
  [/google_calendar/i, 'google_calendar'],
  [/google_people/i, 'google_people'],
  [/graph_ql/i, 'graphql'],
  [/teams_bot|^teams/i, 'teams'],
  [/azure_active_directory|microsoft_entra|cnh_azure/i, 'azure_ad'],
  [/microsoft_graph/i, 'microsoft_graph'],
  [/click_up/i, 'clickup'],
  [/pipedrive/i, 'pipedrive'],
  [/notion/i, 'notion'],
  [/freshdesk/i, 'freshdesk'],
  [/convert_api/i, 'convertapi'],
  [/pdf_monkey|pdfmonkey/i, 'pdf'],
  [/xml_parser|xml_creator/i, 'xml'],
  [/json_parser/i, 'json_parser'],
  [/csv_parser/i, 'csv_parser'],
  [/^ftps?$/i, 'sftp'],
  [/salesforce/i, 'salesforce'],
  [/netsuite/i, 'netsuite'],
  [/success_factors|sap_sf_/i, 'success_factors'],
  [/omie/i, 'omie'],
  [/personio/i, 'personio'],
  [/ceridian|dayforce/i, 'dayforce'],
  [/abbyy/i, 'abbyy'],
  [/jump_cloud/i, 'jump_cloud'],
  [/google_document_ai/i, 'google_document_ai'],
  [/workato_pub_sub/i, 'workato_pub_sub'],
  [/open_ai/i, 'open_ai'],
  [/^excel/i, 'excel'],
  [/^onedrive/i, 'onedrive'],
  [/microsoft_sharepoint/i, 'microsoft_sharepoint'],
  [/facebook_lead/i, 'facebook_lead_ads'],
  [/^clock$/i, 'clock'],
];

const CONTROL_KEYWORDS = new Set([
  'if',
  'elsif',
  'elseif',
  'else',
  'foreach',
  'repeat',
  'while_condition',
  'try',
  'catch',
  'stop',
  'comment',
]);

const CHILD_KEYS = ['nextAction', 'firstLoopAction', 'onFailureAction'];

const TODO_PATTERNS = [
  {
    kind: 'formula vira codigo',
    re: /AP-MIGRATION-TODO: traduzir formula Ruby/,
    severity: 'revisar',
  },
  { kind: 'AP-MIGRATION-TODO', re: /AP-MIGRATION-TODO/, severity: 'bloqueia' },
  { kind: 'TODO_FORMULA', re: /TODO_FORMULA/, severity: 'bloqueia' },
  { kind: 'TODO_pill', re: /TODO_pill/, severity: 'bloqueia' },
  { kind: 'TODO_ref', re: /TODO_ref/, severity: 'revisar' },
  { kind: 'TODO(LLM)', re: /TODO\(LLM\)/, severity: 'revisar' },
  { kind: 'TODO_lista', re: /TODO_lista/, severity: 'revisar' },
];

const EMPTY_PROP_KEYS = new Set([
  'pipeId',
  'pipe_id',
  'organizationId',
  'channel',
  'query',
  'url',
  'items',
  'cronExpression',
]);

export function collapseProvider(provider) {
  const p = String(provider ?? '');
  for (const [rx, name] of COLLAPSE_RULES) {
    if (rx.test(p)) return name;
  }
  const stripped = p.replace(CONNECTOR_SUFFIX, '');
  return stripped.length > 0 ? stripped : p;
}

export function collapseOpKey(opKey) {
  const i = String(opKey).indexOf('/');
  if (i < 0) return opKey;
  return `${collapseProvider(opKey.slice(0, i))}/${opKey.slice(i + 1)}`;
}

export function lookupMap(operations, opKey) {
  if (!operations || typeof operations !== 'object') return undefined;
  if (operations[opKey]) return operations[opKey];
  const collapsed = collapseOpKey(opKey);
  if (collapsed !== opKey && operations[collapsed]) return operations[collapsed];
  const lower = collapsed.toLowerCase();
  for (const [key, value] of Object.entries(operations)) {
    if (key.toLowerCase() === lower || collapseOpKey(key).toLowerCase() === lower) return value;
  }
  return undefined;
}

function parseTime(triggerAt) {
  const m = String(triggerAt ?? '00:00').match(/(\d{1,2}):(\d{2})/);
  if (!m) return { minute: 0, hour: 0 };
  return {
    hour: Math.min(23, Math.max(0, Number(m[1]))),
    minute: Math.min(59, Math.max(0, Number(m[2]))),
  };
}

function everyN(raw, min = 1) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= min ? n : min;
}

function weekDays(raw) {
  const days = String(raw ?? '')
    .split(/[,\s]+/)
    .map((d) => d.trim())
    .filter(Boolean);
  return days.length ? days.join(',') : '*';
}

export function workatoScheduleToCron(input = {}) {
  const explicit = String(input.cron_expression ?? '').trim();
  if (explicit) return explicit;
  const unit = String(input.time_unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const n = everyN(input.trigger_every);
  const { minute, hour } = parseTime(input.trigger_at);
  switch (unit) {
    case 'minutes':
    case 'minute':
      return `*/${n} * * * *`;
    case 'hours':
    case 'hour':
      return `${minute} */${n} * * *`;
    case 'days':
    case 'day':
      return n === 1 ? `${minute} ${hour} * * *` : `${minute} ${hour} */${n} * *`;
    case 'weeks':
    case 'week':
      return `${minute} ${hour} * * ${weekDays(input.days_of_week)}`;
    case 'months':
    case 'month': {
      const dom = String(input.days_of_month ?? input.day_of_month ?? '1').trim();
      const day = !dom || dom === 'last_day' ? 'L' : dom;
      return `${minute} ${hour} ${day} */${n} *`;
    }
    default:
      return undefined;
  }
}

export function scheduleCronTodo(input = {}, cron) {
  const unit = String(input.time_unit ?? '').toLowerCase();
  const n = everyN(input.trigger_every);
  if ((unit === 'weeks' || unit === 'week') && n > 1) {
    return `Workato trigger_every=${n} weeks nao cabe em cron semanal; gerado ${cron} (toda semana)`;
  }
  if ((unit === 'months' || unit === 'month') && String(input.days_of_month ?? '') === 'last_day') {
    return `days_of_month=last_day virrou dia L no cron (${cron})`;
  }
  return undefined;
}

function recipeCode(recipe) {
  const raw = recipe?.code ?? {};
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function walkWorkato(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walkWorkato(child, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node);
  const keyword = node.keyword ?? '';
  if (node.skip === true && CONTROL_KEYWORDS.has(keyword)) return;
  if (Array.isArray(node.block)) walkWorkato(node.block, visit);
}

function directStop(children) {
  return (children || []).some((child) => child && child.skip !== true && child.keyword === 'stop');
}

/** Mesma repartição de `splitBranches`: o corpo do if, cada elsif e o else. */
function splitRawBranches(step) {
  const branches = [{ children: [] }];
  const skipped = [];
  let elseChildren = [];
  const trailing = [];
  let seenElse = false;
  for (const child of step?.block || []) {
    if (!child || typeof child !== 'object') continue;
    if (child.keyword === 'elsif' || child.keyword === 'elseif') {
      if (child.skip === true) skipped.push(child);
      else branches.push({ children: [...(child.block || [])] });
    } else if (child.keyword === 'else') {
      seenElse = true;
      if (child.skip === true) skipped.push(child);
      else elseChildren = Array.isArray(child.block) ? child.block : [];
    } else if (!seenElse) {
      branches[branches.length - 1].children.push(child);
    } else {
      trailing.push(child);
    }
  }
  return { branches, elseChildren, trailing, skipped };
}

/** Todo ramo do if, inclusive o else vazio, tem um `stop` direto. O else ausente não para. */
function allBranchesStop(step) {
  const { branches, elseChildren } = splitRawBranches(step);
  return [...branches.map((branch) => directStop(branch.children)), directStop(elseChildren)].every(Boolean);
}

/** A cadeia termina num stop, então o que vem depois no mesmo bloco não roda. */
function chainCloses(block) {
  for (const child of block || []) {
    if (!child || typeof child !== 'object' || child.skip === true) continue;
    if (child.keyword === 'stop') return true;
    if (child.keyword === 'if' && allBranchesStop(child)) return true;
    if (child.keyword === 'try') {
      const body = (child.block || []).filter((item) => item?.keyword !== 'catch');
      if (chainCloses(body)) return true;
    }
  }
  return false;
}

/**
 * Percorre o bloco como `buildChain`: um `stop` ativo encerra os irmãos seguintes,
 * e um `if` em que todo ramo para encerra o que vem depois. O `catch` do `try`
 * continua alcançável mesmo se o corpo parar.
 */
function walkBlock(block, visit) {
  if (!Array.isArray(block)) return;
  let open = true;
  for (const child of block) {
    if (!child || typeof child !== 'object') continue;
    if (!open) continue;
    const keyword = child.keyword ?? '';
    if (child.skip === true && CONTROL_KEYWORDS.has(keyword)) {
      visit(child);
      continue;
    }
    if (keyword === 'if') {
      visit(child);
      const split = splitRawBranches(child);
      for (const branch of split.branches) walkBlock(branch.children, visit);
      for (const skipped of split.skipped) visit(skipped);
      walkBlock(split.elseChildren, visit);
      walkBlock(split.trailing, visit);
      if (allBranchesStop(child)) open = false;
      continue;
    }
    if (keyword === 'try') {
      visit(child);
      const body = (child.block || []).filter((item) => item?.keyword !== 'catch');
      const catchNode = (child.block || []).find((item) => item?.keyword === 'catch');
      walkBlock(body, visit);
      if (catchNode) {
        visit(catchNode);
        if (catchNode.skip !== true) walkBlock(catchNode.block, visit);
      }
      const bodyCloses = chainCloses(body);
      if (bodyCloses) open = false;
      continue;
    }
    visit(child);
    if (keyword === 'stop') {
      open = false;
      continue;
    }
    if (Array.isArray(child.block)) walkBlock(child.block, visit);
  }
}

export function collectWorkatoTree(recipe) {
  const code = recipeCode(recipe);
  const actions = [];
  const controls = [];
  if (code && typeof code === 'object') {
    visitWorkato(code);
    const keyword = code.keyword ?? '';
    if (!(code.skip === true && CONTROL_KEYWORDS.has(keyword))) walkBlock(code.block, visitWorkato);
  }
  function visitWorkato(node) {
    const keyword = node.keyword ?? (node.provider && node.name ? 'action' : '');
    if (node.skip === true) {
      if (CONTROL_KEYWORDS.has(keyword) && keyword !== 'comment') {
        controls.push({ keyword, skip: true, as: node.as ?? null });
      }
      return;
    }
    if (keyword === 'if' || keyword === 'foreach' || keyword === 'repeat' || keyword === 'try') {
      const catchNode = keyword === 'try'
        ? (node.block ?? []).find((child) => child?.keyword === 'catch')
        : null;
      const catchChildren = (catchNode?.block ?? []).filter((child) => child?.keyword !== 'catch');
      const activeCatch = catchChildren.filter((child) => child?.skip !== true);
      const catchStopOnly = activeCatch.length === 1 && activeCatch[0]?.keyword === 'stop';
      controls.push({
        keyword,
        skip: false,
        as: node.as ?? null,
        source: typeof node.source === 'string' ? node.source : null,
        hasCatchBody: Boolean(catchChildren.length) && !catchStopOnly,
        catchStopOnly,
        stopWithError: false,
      });
      return;
    }
    if (keyword === 'stop' && String(node.input?.stop_with_error) === 'true') {
      controls.push({ keyword: 'stop', skip: false, stopWithError: true, as: node.as ?? null });
      return;
    }
    if (CONTROL_KEYWORDS.has(keyword)) return;
    if (!node.provider || !node.name) return;
    if (keyword !== 'action' && keyword !== 'trigger') return;
    actions.push({
      opKey: `${node.provider}/${node.name}`,
      provider: node.provider,
      name: node.name,
      keyword,
      as: node.as ?? null,
      comment: node.comment ?? null,
      input: node.input ?? {},
    });
  }
  const triggerFilter = Boolean(
    code?.filter &&
      (Array.isArray(code.filter.conditions) ? code.filter.conditions.length : code.filter),
  );
  return { actions, controls, trigger: code, triggerFilter };
}

export function collectWorkatoActions(recipe) {
  return collectWorkatoTree(recipe).actions;
}

export function walkFlowSteps(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (node.type) acc.push(node);
  for (const key of CHILD_KEYS) if (node[key]) walkFlowSteps(node[key], acc);
  const branches = node.continueOnFailureBranches;
  if (branches) {
    walkFlowSteps(branches.onSuccess, acc);
    walkFlowSteps(branches.onFailure, acc);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkFlowSteps(child, acc);
  }
  return acc;
}

export function flowTrigger(flow) {
  return flow?.flows?.[0]?.trigger ?? flow?.trigger ?? null;
}

function stepBlob(step) {
  if (!step || typeof step !== 'object') return '';
  const own = { ...step };
  for (const key of CHILD_KEYS) delete own[key];
  delete own.children;
  try {
    return JSON.stringify(own);
  } catch {
    return '';
  }
}

function pieceNameOf(step) {
  return String(step?.settings?.pieceName ?? '');
}

function opNameOf(step) {
  return String(step?.settings?.actionName ?? step?.settings?.triggerName ?? '');
}

function isTodoPiece(step) {
  return pieceNameOf(step) === 'TODO' || opNameOf(step) === 'TODO';
}

/** Step TODO só representa a action cujo nome é o displayName (send_mail → email/send_mail). */
function todoPieceMatches(step, action) {
  if (!isTodoPiece(step)) return false;
  const display = String(step.displayName ?? '').trim();
  if (!display || display === 'TODO') return false;
  const name = String(action?.name ?? '');
  const opKey = String(action?.opKey ?? '');
  return display === name || display === action?.comment || display === opKey || opKey.endsWith(`/${display}`);
}

function workatoOpForTodoStep(actions, step) {
  const hit = (actions ?? []).find((action) => todoPieceMatches(step, action));
  if (hit?.opKey) return hit.opKey;
  const display = String(step?.displayName ?? '').trim();
  return display && display !== 'TODO' ? display : '';
}

function isMigrationReviewNote(step) {
  const name = String(step?.name ?? '');
  const display = String(step?.displayName ?? '');
  return (
    name.startsWith('review_catch_') ||
    name.startsWith('review_stop_') ||
    display.startsWith('REVISAR: try/catch') ||
    display.startsWith('REVISAR: stop_with_error')
  );
}

function isCatchRouter(step) {
  return step?.type === 'ROUTER' && step.displayName === 'Catch do monitor';
}

/** Ramo de condicao vazio (o stop) que ainda segue para um passo da receita. */
function routerLeaksPastStop(step) {
  if (!step || step.type !== 'ROUTER' || isCatchRouter(step)) return false;
  let next = step.nextAction;
  while (next && isCatchRouter(next)) next = next.nextAction;
  if (!next) return false;
  const branches = step.settings?.branches ?? [];
  const children = step.children ?? [];
  for (let i = 0; i < branches.length; i++) {
    if (branches[i]?.branchType === 'FALLBACK') continue;
    if (children[i] == null) return true;
  }
  return false;
}

function sourceCodeOf(step) {
  return String(step?.settings?.sourceCode?.code ?? '');
}

export function collectTodos(steps) {
  const todos = [];
  for (const step of steps) {
    const name = String(step.name ?? '');
    const display = String(step.displayName ?? name);
    if (isTodoPiece(step)) {
      todos.push({
        kind: opNameOf(step) === 'REPEAT_UNSUPPORTED' ? 'REPEAT_UNSUPPORTED' : 'piece TODO',
        step: name,
        displayName: display,
        detail: `${pieceNameOf(step)}/${opNameOf(step)}`,
        severity: opNameOf(step) === 'REPEAT_UNSUPPORTED' ? 'revisar' : 'bloqueia',
      });
    }
    const blob = stepBlob(step);
    const seen = new Set();
    for (const { kind, re, severity } of TODO_PATTERNS) {
      if (!re.test(blob) || seen.has(kind)) continue;
      seen.add(kind);
      todos.push({ kind, step: name, displayName: display, detail: kind, severity });
    }
  }
  return todos;
}

function cronOf(step) {
  const input = step?.settings?.input ?? {};
  return String(input.cronExpression ?? input.cron_expression ?? '').trim();
}

export function collectEmptySchedules(steps) {
  const empty = [];
  for (const step of steps) {
    if (pieceNameOf(step) !== '@activepieces/piece-schedule') continue;
    if (cronOf(step)) continue;
    empty.push({
      step: String(step.name ?? 'trigger'),
      displayName: String(step.displayName ?? ''),
      triggerName: String(step.settings?.triggerName ?? ''),
    });
  }
  return empty;
}

function nonempty(value) {
  return value !== '' && value != null;
}

/** AP delayFor exige `unit` + `delayFor`. Workato manda `interval` (segundos). */
export function delayForHasDuration(input) {
  if (!input || typeof input !== 'object') return false;
  const amount = input.delayFor ?? input.delay_for;
  return nonempty(amount) && nonempty(input.unit);
}

export function delayUntilHasTimestamp(input) {
  if (!input || typeof input !== 'object') return false;
  return nonempty(
    input.delayUntilTimestamp ??
      input.delayUntil ??
      input.delay_until ??
      input.timestamp ??
      input.date,
  );
}

/**
 * piece-delay no canvas sem as props que o editor/runtime leem.
 * `interval` sozinho (Workato) conta como vazio — o AP ignora.
 */
function httpUrlOf(input) {
  const url = input?.url;
  if (url && typeof url === 'object') return String(url.url ?? '').trim();
  return String(url ?? '').trim();
}

/**
 * Get file from URL (Workato file_connector/read_file) vira HTTP GET binario,
 * salvo quando alimenta upload_attachment (o anexo recebe a URL, sem GET).
 * Sem `url` o editor fica vazio — o mesmo gap que Files Helper read_file
 * (file/readOptions) deixava no canvas.
 */
export function collectEmptyFileGets(steps) {
  const empty = [];
  for (const step of steps) {
    const piece = pieceNameOf(step);
    const action = String(step.settings?.actionName ?? '');
    const input = step.settings?.input ?? {};
    const name = String(step.name ?? 'step');
    if (piece === '@activepieces/piece-file-helper' && action === 'read_file' && !input.file) {
      empty.push({ step: name, action, reason: 'Files Helper read_file sem file (nao baixa URL)' });
      continue;
    }
    if (piece !== '@activepieces/piece-http' || action !== 'send_request') continue;
    if (input.response_is_binary !== true) continue;
    if (!httpUrlOf(input)) {
      empty.push({ step: name, action, reason: 'sem url' });
    }
  }
  return empty;
}

const WORKATO_PILL_RE = /_dp\s*\(|_\(\s*['"]data\.|data\.workato_/;
const UNDEFINED_PILL_RE = /\{\{\s*undefined(?:\s*[\[.]|\s*\}\})/;
const BAD_AP_CASE_RE = /\{(?:lowerCase|upperCase)\(/;
const BODYLESS_HTTP = new Set(['GET', 'HEAD']);
const EMAIL_BY_WORKATO = new Set(['email/send_mail']);

function stepInputBlob(step) {
  return [
    JSON.stringify(step?.settings?.input ?? {}),
    JSON.stringify(step?.settings?.branches ?? []),
    JSON.stringify(step?.settings?.items ?? ''),
  ].join('\n');
}

/** Pill que o motor nao resolveu: `{{undefined['recipe_name']}}` publica e nao le dado. */
export function collectUndefinedPills(steps) {
  const hits = [];
  for (const step of steps) {
    const blob = `${stepInputBlob(step)}\n${sourceCodeOf(step)}`;
    if (!UNDEFINED_PILL_RE.test(blob)) continue;
    hits.push({
      step: String(step.name ?? 'step'),
      reason: 'pill undefined — falha silenciosa',
    });
  }
  return hits;
}

/** Pills no schema achatado do Workato: o step parece preenchido e o flow publica, mas nao le dado. */
export function collectWorkatoSchemaPills(steps) {
  const hits = [];
  for (const step of steps) {
    const blob = stepInputBlob(step);
    if (!WORKATO_PILL_RE.test(blob)) continue;
    hits.push({
      step: String(step.name ?? 'step'),
      reason: 'pill no schema Workato (achatado) — falha silenciosa',
    });
  }
  return hits;
}

/** Catalogo AP e `lowercase` / `uppercase`. `lowerCase` num lado so muda o if. */
export function collectBadCaseFormulas(steps) {
  const hits = [];
  for (const step of steps) {
    const blob = `${stepInputBlob(step)}\n${sourceCodeOf(step)}`;
    if (!BAD_AP_CASE_RE.test(blob)) continue;
    hits.push({
      step: String(step.name ?? 'step'),
      reason: 'formula lowerCase/upperCase (grafia AP e lowercase/uppercase)',
    });
  }
  return hits;
}

function httpMethodOf(input) {
  return String(input?.method ?? '').trim().toUpperCase();
}

function httpHasBody(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.body != null && input.body !== '') return true;
  if (input.json != null && input.json !== '') return true;
  return false;
}

/**
 * HTTP fora do padrao do conector: sem URL, ou POST/PUT/PATCH sem body_type
 * (o editor esconde o body e o step fica quebrado).
 */
export function collectHttpPadGaps(steps) {
  const empty = [];
  for (const step of steps) {
    if (pieceNameOf(step) !== '@activepieces/piece-http') continue;
    if (String(step.settings?.actionName ?? '') !== 'send_request') continue;
    const input = step.settings?.input ?? {};
    const name = String(step.name ?? 'step');
    if (!httpUrlOf(input) && input.response_is_binary !== true) {
      empty.push({ step: name, reason: 'HTTP sem url' });
    }
    const method = httpMethodOf(input);
    if (method && !BODYLESS_HTTP.has(method) && httpHasBody(input) && !nonempty(input.body_type)) {
      empty.push({ step: name, reason: 'HTTP sem body_type (body some no editor)' });
    }
  }
  return empty;
}

function peelWorkatoCase(raw) {
  const m = String(raw ?? '')
    .trim()
    .match(/^(.*)\.(upcase|downcase)\s*$/i);
  return m ? { inner: m[1], method: m[2].toLowerCase() } : null;
}

function flattenWorkatoConditions(list, acc = []) {
  if (!Array.isArray(list)) return acc;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (item.lhs != null || item.rhs != null) acc.push(item);
    if (Array.isArray(item.conditions)) flattenWorkatoConditions(item.conditions, acc);
  }
  return acc;
}

export function collectWorkatoBothSidesCase(recipe) {
  const pairs = [];
  walkWorkato(recipeCode(recipe), (node) => {
    const keyword = node?.keyword ?? '';
    if (keyword !== 'if' && keyword !== 'elsif' && keyword !== 'elseif') return;
    for (const cond of flattenWorkatoConditions(node.input?.conditions)) {
      const lhs = peelWorkatoCase(cond.lhs);
      const rhs = peelWorkatoCase(cond.rhs);
      if (lhs && rhs && lhs.method === rhs.method) {
        pairs.push({ method: lhs.method, as: node.as ?? null });
      }
    }
  });
  return pairs;
}

function apCaseFn(method) {
  return method === 'upcase' ? 'uppercase' : 'lowercase';
}

function hasApCase(value, fn) {
  return new RegExp(`\\{${fn}\\(`, 'i').test(String(value ?? ''));
}

function collectRouterCells(steps) {
  const cells = [];
  for (const step of steps) {
    if (step.type !== 'ROUTER') continue;
    for (const branch of step.settings?.branches ?? []) {
      for (const group of branch.conditions ?? []) {
        const list = Array.isArray(group) ? group : [group];
        for (const cell of list) {
          if (cell && typeof cell === 'object') cells.push({ step: step.name, cell });
        }
      }
    }
  }
  return cells;
}

export function collectOneSidedCase(recipe, steps) {
  const pairs = collectWorkatoBothSidesCase(recipe);
  if (!pairs.length) return [];
  const cells = collectRouterCells(steps);
  const hits = [];
  const seen = new Set();
  for (const pair of pairs) {
    const fn = apCaseFn(pair.method);
    for (const { step, cell } of cells) {
      if (cell.secondValue == null || cell.secondValue === '') continue;
      const left = hasApCase(cell.firstValue, fn);
      const right = hasApCase(cell.secondValue, fn);
      if (left === right) continue;
      const key = `${step}|${fn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        step: String(step ?? 'router'),
        reason: `Workato .${pair.method} nos dois lados; flow so tem ${fn} em um`,
      });
    }
  }
  return hits;
}

function variableCodeLooksEmpty(step) {
  const code = sourceCodeOf(step);
  if (!code.trim()) return true;
  return /AP-MIGRATION-TODO/.test(code) && /async\s*\(\s*inputs\s*\)\s*=>\s*inputs/.test(code);
}

function looksLikeVariableStep(step) {
  const display = String(step.displayName ?? '');
  const blob = `${sourceCodeOf(step)}\n${display}\n${opNameOf(step)}`;
  return /workato_variable|declare_variable|update_variable|declare_list|insert_to_list/i.test(blob)
    || pieceNameOf(step) === '@activepieces/piece-store';
}

/** Variavel em branco / stub identity: o iPaaS acusa passo incompleto ou nao grava valor. */
export function collectBrokenVariables(steps) {
  const hits = [];
  for (const step of steps) {
    if (!looksLikeVariableStep(step)) continue;
    const name = String(step.name ?? 'step');
    if (step.type === 'CODE' && variableCodeLooksEmpty(step)) {
      hits.push({ step: name, reason: 'CODE de variavel vazio/stub (nao roda)' });
      continue;
    }
    if (step.type !== 'PIECE' || pieceNameOf(step) === '@activepieces/piece-store') continue;
    const input = step.settings?.input ?? {};
    const filled = Object.values(input).some((value) => nonempty(value));
    if (!filled) hits.push({ step: name, reason: 'step de variavel em branco' });
  }
  return hits;
}

function isEmptyCanvasStep(step) {
  const input = step.settings?.input ?? {};
  const filled = Object.values(input).some((value) => nonempty(value));
  return !filled && !sourceCodeOf(step).trim();
}

/** Repeat while vazio (nao o marcador REPEAT_UNSUPPORTED) impede publicar. */
export function collectEmptyRepeatSteps(steps) {
  const hits = [];
  for (const step of steps) {
    if (opNameOf(step) === 'REPEAT_UNSUPPORTED') continue;
    const display = String(step.displayName ?? '');
    if (!/repeat\s*while/i.test(display)) continue;
    if (isEmptyCanvasStep(step)) {
      hits.push({ step: String(step.name ?? 'step'), reason: 'repeat while vazio' });
    }
  }
  return hits;
}

export function collectEmailGaps(workatoActions, steps) {
  const hasWorkatoEmail = workatoActions.some((action) => EMAIL_BY_WORKATO.has(action.opKey)
    || EMAIL_BY_WORKATO.has(collapseOpKey(action.opKey)));
  if (!hasWorkatoEmail) return [];
  const hits = [];
  for (const step of steps) {
    const piece = pieceNameOf(step);
    if (piece !== '@activepieces/piece-smtp' && piece !== '@activepieces/piece-gmail') continue;
    hits.push({
      step: String(step.name ?? 'step'),
      reason: 'email/send_mail da Workato nao pedia conexao; SMTP/Gmail pede (gap iPaaS)',
    });
  }
  return hits;
}

export function collectEmptyDelays(steps) {
  const empty = [];
  for (const step of steps) {
    if (pieceNameOf(step) !== '@activepieces/piece-delay') continue;
    const action = String(step.settings?.actionName ?? '');
    const input = step.settings?.input ?? {};
    const name = String(step.name ?? 'step');
    if (action === 'delayFor' || action === 'delay_for') {
      if (!delayForHasDuration(input)) {
        empty.push({ step: name, action, reason: 'sem unit/delayFor' });
      }
      continue;
    }
    if (action === 'delayUntil' || action === 'delay_until') {
      if (!delayUntilHasTimestamp(input)) {
        empty.push({ step: name, action, reason: 'sem timestamp' });
      }
    }
  }
  return empty;
}

/** Espelho de `parseRubySleep` em engine/lib/delay.ts: corpo Ruby que só dorme. */
export function isRubySleep(code) {
  if (code == null) return false;
  const body = String(code)
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
  if (body.length !== 1) return false;
  const line = body[0].trim().replace(/;\s*(#.*)?$/, (_full, comment) => comment ?? '');
  const match = line.match(/^(?:Kernel\.)?sleep\s*(?:\(\s*(.+?)\s*\)|([^(].*?))\s*(?:#.*)?$/i);
  if (!match) return false;
  const arg = (match[1] ?? match[2] ?? '').trim();
  return (
    /^\d+(?:\.\d+)?$/.test(arg) ||
    /^\d+(?:\.\d+)?\.(?:seconds?|minutes?|hours?|days?|weeks?)$/i.test(arg) ||
    /^input\[\s*(['"])([^'"]+)\1\s*\]$/.test(arg)
  );
}

/** Ruby que é só sleep nasce como delayFor, não como step CODE. */
function rubySleepEntry(action, operations) {
  if (!String(action.opKey).endsWith('/invoke_custom_ruby_code')) return undefined;
  if (!isRubySleep(action.input?.code)) return undefined;
  const entry =
    lookupMap(operations, 'workato_custom_code/sleep') ??
    lookupMap(operations, 'clock/wait_for_interval');
  return entry?.target ? entry : undefined;
}

function matchesMapped(step, entry) {
  const target = entry?.target;
  if (!target?.piece || !target?.name) return false;
  if (pieceNameOf(step) !== target.piece) return false;
  return opNameOf(step) === target.name;
}

/** O conector GraphQL sai no custom_api_call do Pipefy, na conexão que a receita já usa. */
function matchesPipefyGraphql(step, entry) {
  const target = entry?.target;
  if (target?.piece !== '@activepieces/piece-graphql' || target?.name !== 'send_request') return false;
  if (pieceNameOf(step) !== '@activepieces/piece-pipefy' || opNameOf(step) !== 'custom_api_call') return false;
  const url = step.settings?.input?.url;
  const href = typeof url === 'string' ? url : url?.url;
  return href === 'https://api.pipefy.com/graphql';
}

function matchesLookupFind(step, action) {
  if (!String(action.opKey ?? '').endsWith('/get_entry')) return false;
  const parameters = action.input?.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return false;
  return pieceNameOf(step) === '@activepieces/piece-tables' && opNameOf(step) === 'tables-find-records';
}

function workatoReferencesLine(action, line) {
  const blob = JSON.stringify(action?.input ?? {});
  return blob.includes(`"line":"${line}"`) || blob.includes(`\\"line\\":\\"${line}\\"`);
}

/**
 * read_file que alimenta upload_attachment não vira HTTP GET: o `attachment` recebe a URL.
 * Casa com o uploadAttachment do flow sem consumir step.
 */
function readFileAbsorbedByUpload(action, workatoActions, steps) {
  if (collapseOpKey(action.opKey) !== 'file_connector/read_file' || !action.as) return false;
  const fed = workatoActions.some(
    (other) => other !== action && /\/upload_attachment$/.test(String(other.opKey ?? '')) && workatoReferencesLine(other, action.as),
  );
  if (!fed) return false;
  return steps.some((step) => {
    if (pieceNameOf(step) !== '@activepieces/piece-pipefy' || opNameOf(step) !== 'uploadAttachment') return false;
    const attachment = String(step.settings?.input?.attachment ?? '').trim();
    return attachment !== '' && !/\['body'\]/.test(attachment);
  });
}

/**
 * read_file que só alimenta parse_csv sai do canvas: o read_csv_file baixa a URL.
 * Outro consumidor da mesma linha mantém o HTTP GET.
 */
function readFileAbsorbedByParseCsv(action, workatoActions, steps) {
  if (collapseOpKey(action.opKey) !== 'file_connector/read_file' || !action.as) return false;
  const fed = workatoActions.some(
    (other) => collapseOpKey(other.opKey) === 'csv_parser/parse_csv' && workatoReferencesLine(other, action.as),
  );
  if (!fed) return false;
  const shared = workatoActions.some(
    (other) => other !== action
      && collapseOpKey(other.opKey) !== 'csv_parser/parse_csv'
      && workatoReferencesLine(other, action.as),
  );
  if (shared) return false;
  return steps.some(
    (step) => pieceNameOf(step) === '@activepieces/piece-csv' && opNameOf(step) === 'read_csv_file',
  );
}

function matchesReadCsvFile(step, action) {
  if (collapseOpKey(action.opKey) !== 'csv_parser/parse_csv') return false;
  return pieceNameOf(step) === '@activepieces/piece-csv' && opNameOf(step) === 'read_csv_file';
}

/** create_csv_lines com `____source` vira Code que devolve `{ csv, fileName, dataUri }`. */
function matchesCsvLinesCode(step, action) {
  if (collapseOpKey(action.opKey) !== 'csv_parser/create_csv_lines') return false;
  if (step?.type !== 'CODE') return false;
  const code = sourceCodeOf(step);
  return code.includes('dataUri') && code.includes('data:text/csv;base64,');
}

function matchesCode(step, opKey) {
  if (step.type !== 'CODE') return false;
  return sourceCodeOf(step).includes(opKey);
}

/** Cabeçalho do step que o motor emite em `variableCode`. */
const VAR_HEADER =
  /Variavel Workato "[^"\n]*" \((escalar|lista)\) — (insert_batch|declare|update|insert|clear)\./;

function jsonStringList(value) {
  if (Array.isArray(value)) return value.every((item) => typeof item === 'string');
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) return true;
  return /^\{\{[\s\S]+\}\}$/.test(trimmed);
}

function listWriteIsNotJsonStrings(step) {
  const action = opNameOf(step);
  const listed = action === 'add_to_list'
    || (action === 'put' && /Gravar lista/.test(String(step.displayName ?? '')));
  if (!listed) return false;
  return !jsonStringList(step.settings?.input?.value);
}

function materializedVariable(step) {
  if (step.type !== 'CODE' || variableCodeLooksEmpty(step)) return null;
  const code = sourceCodeOf(step);
  const header = code.match(VAR_HEADER);
  if (!header) return null;
  const label = code.match(/Variavel Workato "([^"\n]*)"/)?.[1] ?? '';
  return { kind: header[1], op: header[2], label };
}

/**
 * Rótulos das variáveis escalares escritas e lidas no mesmo caminho (APR-0016).
 * O motor emite essas como saída de Code; Storage fica para acumular em loop
 * ou cruzar ramo.
 */
function linearVariableLabels(recipe) {
  const toStep = (node) => ({
    keyword: node?.keyword ?? 'action',
    provider: node?.provider,
    name: node?.name,
    as: node?.as,
    comment: node?.comment,
    skip: node?.skip === true,
    input: node?.input ?? {},
    filter: node?.filter && typeof node.filter === 'object' ? node.filter : undefined,
    source: typeof node?.source === 'string' ? node.source : undefined,
    children: Array.isArray(node?.block) ? node.block.map(toStep) : [],
  });
  try {
    const { decls } = indexVariables(toStep(recipeCode(recipe)));
    return new Set([...decls.values()].filter((decl) => decl.strategy === 'linear').map((decl) => decl.label));
  } catch {
    return new Set();
  }
}

/**
 * `workato_variable` materializado não repete o opKey no fonte (o golden do motor
 * exige isso). Casa pelo cabeçalho: escalar/lista + declare/update/insert.
 */
function matchesMaterializedVariable(step, action) {
  const opKey = String(action.opKey ?? '');
  if (!opKey.startsWith('workato_variable/')) return false;
  const got = materializedVariable(step);
  if (!got) return null;
  const name = opKey.slice('workato_variable/'.length);
  if (name === 'declare_variable') return got.kind === 'escalar' && got.op === 'declare';
  if (name === 'declare_list') return got.kind === 'lista' && got.op === 'declare';
  if (name === 'update_variables' || name === 'update_variable') return got.op === 'update';
  if (name === 'insert_to_list') return got.op === 'insert';
  if (name === 'insert_to_list_batch') return got.op === 'insert_batch';
  if (name === 'clear_list') return got.op === 'clear';
  return false;
}

/** Declare só com schema, sem `data`. Não vira `put` e não consome o update. */
function scalarDeclareIsEmpty(action) {
  if (action?.opKey !== 'workato_variable/declare_variable') return false;
  const input = action.input ?? {};
  if (input.value != null && typeof input.name === 'string' && !input.variables) return false;
  const variables = input.variables;
  if (!variables || typeof variables !== 'object' || !variables.schema) return false;
  const data = variables.data;
  if (data == null) return true;
  return typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0;
}

const ELIDED_SIZED_CREATE_LIST_SNIPPET = 'create_list elidido: o foreach itera o array de origem';
const UNMAPPED_TRIGGER_PLACEHOLDER_SNIPPET = 'foi substituído por catch_webhook';
const TODO_REVIEW_LABELS = [
  'REVISAR: operação sem mapa',
  'REVISAR: email',
  'REVISAR: sms',
  'AVISO: repeat adaptado',
];

function matchesElidedSizedCreateList(action, notes) {
  if (collapseOpKey(action.opKey) !== 'workato_list/create_list' || !action.as) return false;
  return notes.some((note) => {
    const content = String(note.content ?? '');
    const id = String(note.id ?? '');
    if (!content.includes(ELIDED_SIZED_CREATE_LIST_SNIPPET)) return false;
    return id.includes(action.as) || content.includes(action.as);
  });
}

function workatoPillPayload(fragment) {
  try {
    const value = JSON.parse(String(fragment).replace(/\\'/g, "'"));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** `size` que é só `<array>.length`: a lista sai vazia e só dimensiona o foreach. */
function sizedCreateListSize(input) {
  const keys = Object.keys(input ?? {}).filter((key) => !blankWorkatoValue(input[key]));
  if (keys.length !== 1 || keys[0] !== 'size') return false;
  const raw = String(input.size).trim().replace(/^=\s*/, '');
  return /^(?:#\{)?_dp\('(?:\\'|[^'])*'\)\}?\.length$/.test(raw);
}

/**
 * O motor elide o `create_list` dimensionado sem nota (APR-0020): o foreach que
 * itera essa lista passa a iterar o array de origem.
 */
function matchesElidedSizedCreateListLoop(action, controls, steps) {
  if (collapseOpKey(action.opKey) !== 'workato_list/create_list' || !action.as) return false;
  if (!sizedCreateListSize(action.input)) return false;
  const loops = controls.filter((control) => {
    if (control.keyword !== 'foreach' || control.skip || !control.source) return false;
    const found = String(control.source).match(/_dp\('((?:\\'|[^'])*)'\)/);
    const dp = found ? workatoPillPayload(found[1]) : null;
    return Boolean(dp) && Array.isArray(dp.path) && dp.path[0] === 'list' && String(dp.line) === action.as;
  });
  if (loops.length !== 1) return false;
  return steps.some((step) => step?.type === 'LOOP_ON_ITEMS');
}

function hasCanvasNoteForTodoStep(notes, step) {
  const name = String(step.name ?? '');
  const display = String(step.displayName ?? '');
  return notes.some((note) => {
    const content = String(note.content ?? '');
    if (!TODO_REVIEW_LABELS.some((label) => content.includes(label))) return false;
    return content.includes(`\`${name}\``) || content.includes(name) || (display && content.includes(display));
  });
}

/** `update_card` só com ids. A Workato não muda o card; o motor não emite o passo. */
const EMPTY_FORMULA = /^=\s*(?:\(\s*\)|null|clear)?\s*$/i;

function blankWorkatoValue(value) {
  if (value == null || value === '' || value === '=skip') return true;
  return typeof value === 'string' && EMPTY_FORMULA.test(value.trim());
}

/** Update sem campo de negócio. O motor também não emite o updateCard. */
function updateCardWritesNoField(action) {
  const op = String(action?.opKey ?? '');
  const name = op.slice(op.lastIndexOf('/') + 1);
  if (name !== 'update_card' && name !== 'update_card_field' && name !== 'update_fields_values') return false;
  const input = action.input ?? {};
  if (name === 'update_card_field') {
    return blankWorkatoValue(input.new_value) && blankWorkatoValue(input.value);
  }
  if (name === 'update_fields_values') {
    const fields = input.Fields_to_update ?? input.fields_to_update;
    if (!Array.isArray(fields) || !fields.length) return true;
    return fields.every((item) => !item || typeof item !== 'object' || blankWorkatoValue(item.value));
  }
  const meta = new Set(['organization_id', 'card_id', 'pipe_id', 'phase_id', 'id', 'node_ID', 'Node_Id', 'node_id']);
  const keys = Object.keys(input).filter((key) => !blankWorkatoValue(input[key]));
  return keys.length > 0 && keys.every((key) => meta.has(key));
}

function matchesStoredVariable(step, action) {
  const opKey = String(action.opKey ?? '');
  if (!opKey.startsWith('workato_variable/')) return false;
  if (pieceNameOf(step) !== '@activepieces/piece-store') return false;
  const actionName = opNameOf(step);
  if (!actionName || actionName === 'get') return false;
  const name = opKey.slice('workato_variable/'.length);
  const value = step.settings?.input?.value;
  // Escalar atual: um campo, valor cru (string). Objeto legado ainda casa.
  // `[]` fica com a lista.
  const scalarPut =
    actionName === 'put' &&
    value != null &&
    !Array.isArray(value) &&
    ((typeof value === 'object') || (typeof value === 'string' && value !== '[]'));
  const emptyListPut = actionName === 'put' && value === '[]';
  if (name === 'declare_variable' || name === 'update_variables' || name === 'update_variable') {
    return scalarPut;
  }
  if (name === 'clear_list') return emptyListPut || actionName === 'remove_value';
  // Declare vazio não tem step; dentro de loop o motor zera com `remove_value`.
  if (name === 'declare_list') return actionName === 'add_to_list' || actionName === 'remove_value';
  if (name === 'insert_to_list' || name === 'insert_to_list_batch') return actionName === 'add_to_list';
  return false;
}

const ASYNC_WAIT_NOTE = 'A espera de jobs assíncronos não foi transportada';

/** `get_cards_by_field` com include_done false vira CODE: a piece não filtra card concluído. */
function isOpenCardsSearch(action) {
  return String(action?.opKey ?? '').endsWith('/get_cards_by_field') && includeDoneIsFalse(action.input);
}

function matchesOpenCards(step) {
  return step?.type === 'CODE' && sourceCodeOf(step).includes('include_done: false');
}

function canvasNotes(flow) {
  if (Array.isArray(flow?.flows?.[0]?.notes)) return flow.flows[0].notes;
  if (Array.isArray(flow?.notes)) return flow.notes;
  return [];
}

function matchesFallback(step, action, entry) {
  const display = String(step.displayName ?? '');
  if (display !== action.name && display !== action.comment) return false;
  if (entry?.target?.piece && pieceNameOf(step) && pieceNameOf(step) !== entry.target.piece) {
    return false;
  }
  return true;
}

export function findMissingActions(workatoActions, steps, operations, notes = [], controls = []) {
  const used = new Set();
  const usedNotes = new Set();
  const missing = [];

  const actionLabel = (action) => (action.comment ? action.comment : action.name);

  const displayMatches = (step, action) => {
    const display = String(step?.displayName ?? '');
    if (!display) return false;
    return display === actionLabel(action);
  };

  const take = (predicate, action) => {
    let loose = -1;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (used.has(i) || step?.type === 'PIECE_TRIGGER' || !predicate(step)) continue;
      if (displayMatches(step, action)) {
        used.add(i);
        return true;
      }
      const display = String(step?.displayName ?? '');
      const reserved =
        display !== '' && pending.some((other) => other !== action && display === actionLabel(other));
      if (!reserved && loose === -1) loose = i;
    }
    if (loose === -1) return false;
    used.add(loose);
    return true;
  };

  const takeNote = (predicate) => {
    const index = notes.findIndex((note, i) => !usedNotes.has(i) && predicate(note));
    if (index === -1) return false;
    usedNotes.add(index);
    return true;
  };

  const pending = workatoActions.filter(
    (action) =>
      action.keyword !== 'trigger' &&
      !scalarDeclareIsEmpty(action) &&
      !isEmptyListDeclare(action) &&
      !updateCardWritesNoField(action),
  );

  for (const action of [...pending]) {
    const mapEntry = lookupMap(operations, action.opKey);
    const sleepEntry = rubySleepEntry(action, operations);
    const entry = sleepEntry ?? mapEntry;
    const openCards = isOpenCardsSearch(action);
    const asyncWait = String(action.opKey ?? '').endsWith('/wait_for_async_jobs');
    const found =
      (asyncWait && takeNote((note) => String(note?.content ?? '').includes(ASYNC_WAIT_NOTE))) ||
      (!asyncWait &&
        matchesElidedSizedCreateList(action, notes) &&
        takeNote(
          (note) =>
            String(note.content ?? '').includes(ELIDED_SIZED_CREATE_LIST_SNIPPET) &&
            String(note.content ?? '').includes(action.as),
        )) ||
      (!asyncWait && openCards && take((step) => matchesOpenCards(step), action)) ||
      (!asyncWait && readFileAbsorbedByUpload(action, workatoActions, steps)) ||
      (!asyncWait && readFileAbsorbedByParseCsv(action, workatoActions, steps)) ||
      (!asyncWait && take((step) => matchesCsvLinesCode(step, action), action)) ||
      (!asyncWait && !openCards && entry?.target && take((step) => matchesMapped(step, entry) || matchesReadCsvFile(step, action) || matchesPipefyGraphql(step, entry) || matchesLookupFind(step, action), action)) ||
      (!asyncWait && (entry?.manual || entry?.builtin || action.opKey.endsWith('/invoke_custom_ruby_code')) &&
        take((step) => matchesCode(step, action.opKey) || matchesMaterializedVariable(step, action) || matchesStoredVariable(step, action), action)) ||
      (!asyncWait && !entry?.target &&
        take(
          (step) =>
            todoPieceMatches(step, action) || matchesCode(step, action.opKey) || matchesMaterializedVariable(step, action) || matchesStoredVariable(step, action),
          action,
        )) ||
      (!asyncWait && take((step) => matchesFallback(step, action, entry), action)) ||
      (!asyncWait && matchesElidedSizedCreateListLoop(action, controls, steps));

    if (found) {
      const index = pending.indexOf(action);
      if (index !== -1) pending.splice(index, 1);
    }
    if (!found) {
      missing.push({
        opKey: action.opKey,
        keyword: action.keyword,
        as: action.as,
        mapped: Boolean(entry?.target),
        piece: entry?.target?.piece ?? null,
        action: entry?.target?.name ?? null,
      });
    }
  }
  return { missing, used };
}

function needsAuth(pieceName) {
  return Boolean(pieceName) && pieceName !== 'TODO' && !NO_AUTH_PIECES.has(pieceName);
}

function hasAuthRef(step) {
  return /\{\{\s*connections\['[^']+'\]\s*\}\}/.test(String(step?.settings?.input?.auth ?? ''));
}

function finding(severity, kind, detail, step = '') {
  return { severity, kind, detail, step };
}

const SUBFLOW_ACTIONS = new Set(['callFlow', 'callableFlow', 'returnResponse']);
const PIPEFY_PIECE = '@activepieces/piece-pipefy';
const SUBFLOWS_PIECE = '@activepieces/piece-subflows';
const SUBFLOWS_PIECE_VERSION = SUBFLOW_PIECE_VERSION;

function includeDoneIsFalse(input) {
  const raw = input?.include_done ?? input?.includeDone;
  if (raw == null || raw === '') return false;
  return /^(false|no|0)$/i.test(String(raw).trim());
}

function inputBlob(step) {
  try {
    return JSON.stringify(step?.settings?.input ?? {});
  } catch {
    return '';
  }
}

/** Texto `erro` no valor. A chave de um campo Pipefy com esse id não é a pill. */
function valueIsLiteralErro(value) {
  if (typeof value === 'string') {
    if (value.includes("['error']['message']")) return false;
    return value === 'erro' || /:\s*erro\b/.test(value);
  }
  if (Array.isArray(value)) return value.some(valueIsLiteralErro);
  if (value && typeof value === 'object') return Object.values(value).some(valueIsLiteralErro);
  return false;
}

function codeUsesNpm(step) {
  const raw = step?.settings?.sourceCode?.packageJson;
  if (raw && raw !== '{}') {
    try {
      const deps = JSON.parse(String(raw)).dependencies ?? {};
      if (deps && Object.keys(deps).length) return true;
    } catch {
      if (String(raw).includes('"dependencies"')) return true;
    }
  }
  const code = sourceCodeOf(step);
  return /\brequire\s*\(\s*['"][^.['"]/.test(code) || /\bfrom\s+['"][^.['"]/.test(code);
}

/**
 * Regras da Rafa (Invenergy, 2026-09-23): o que o flow gerado faz de diferente
 * do gabarito que ela testou. Não chama o destino.
 */
export function collectRafaGaps(recipe, flow, steps) {
  const tree = collectWorkatoTree(recipe ?? {});
  const actions = tree.actions;
  const gaps = [];

  const parses = actions.filter((action) => collapseOpKey(action.opKey) === 'csv_parser/parse_csv');
  if (parses.length) {
    for (const step of steps) {
      if (pieceNameOf(step) !== '@activepieces/piece-csv') continue;
      // read_csv_file é o caminho nativo (APR-0024). convert_csv_to_json não declara header_schema.
      if (opNameOf(step) !== 'convert_csv_to_json') continue;
      gaps.push(finding(
        'bloqueia',
        'parse csv',
        `${step.name} parse_csv virou piece-csv; converter para Code JS que nomeia as colunas`,
        step.name,
      ));
    }
  }

  for (const action of actions) {
    if (!String(action.opKey).endsWith('/invoke_custom_py_code')) continue;
    const step = steps.find((item) => matchesCode(item, action.opKey));
    if (!step) {
      gaps.push(finding('bloqueia', 'python', `${action.opKey} nao virou Code JS`, action.as ?? ''));
      continue;
    }
    if (codeUsesNpm(step)) {
      gaps.push(finding(
        'revisar',
        'python pacote',
        `${step.name} Code JS com pacote npm; em ST o sandbox e ECMAScript puro. Skill sem-dependencia reescreve`,
        step.name,
      ));
    }
  }

  const erroSteps = [];
  const outputErrorSteps = [];
  for (const step of steps) {
    const blob = inputBlob(step);
    if (valueIsLiteralErro(step?.settings?.input)) erroSteps.push(step.name);
    if (/\['output'\]\['error'\]/.test(blob) || /output\.error/.test(blob)) outputErrorSteps.push(step.name);
  }
  if (erroSteps.length) {
    gaps.push(finding(
      'bloqueia',
      'pill de erro',
      `pill de catch virou o texto erro em ${erroSteps.length} step(s); o iPaaS le ['error']['message']`,
    ));
  }
  if (outputErrorSteps.length) {
    gaps.push(finding(
      'bloqueia',
      'pill de erro',
      `erro como filho de output em ${outputErrorSteps.join(', ')}; o iPaaS le ['error']['message']`,
    ));
  }

  const failureSteps = steps.filter((step) => step.onFailureAction);
  const catchBodies = tree.controls.filter((control) => control.hasCatchBody);
  if (catchBodies.length && failureSteps.length) {
    gaps.push(finding(
      'bloqueia',
      'CATCH',
      `try/catch foi para onFailureAction de ${failureSteps.length} step(s); o indicado e um router no fim, um branch por bloco monitor`,
    ));
  }

  for (const step of steps) {
    const blob = inputBlob(step);
    const nativeList = opNameOf(step) === 'updateListField';
    const custom = opNameOf(step) === 'custom_api_call' || opNameOf(step) === 'send_request';
    if (!custom || nativeList) continue;
    if (/updateFieldsValues/i.test(blob) && /\bADD\b/.test(blob)) {
      gaps.push(finding(
        'bloqueia',
        'acao nativa',
        `${step.name} custom API updateFieldsValues ADD; usar updateListField`,
        step.name,
      ));
    }
  }

  const pinned = new Map();
  for (const step of steps) {
    const piece = pieceNameOf(step);
    const version = String(step.settings?.pieceVersion ?? '');
    if (piece === PIPEFY_PIECE) {
      if (version !== PIPEFY_PIECE_VERSION) pinned.set(piece, version || '(ausente)');
      continue;
    }
    if (piece === SUBFLOWS_PIECE) {
      if (version !== SUBFLOWS_PIECE_VERSION) pinned.set(piece, version || '(ausente)');
    }
  }
  if (pinned.size) {
    const schema = flow?.flows?.[0]?.schemaVersion ?? flow?.schemaVersion ?? '';
    const list = [...pinned.entries()].map(([piece, version]) => `${piece} ${version}`).join(', ');
    gaps.push(finding(
      'bloqueia',
      'versao do piece',
      `versao do piece: ${list}${schema ? ` (schema ${schema})` : ''}; piece-pipefy fica ${PIPEFY_PIECE_VERSION}; piece-subflows fica ${SUBFLOWS_PIECE_VERSION}`,
    ));
  }

  for (const step of steps) {
    const name = opNameOf(step);
    if (!SUBFLOW_ACTIONS.has(name)) continue;
    const mode = String(step.settings?.input?.mode ?? '');
    if (mode !== 'simple' && mode !== 'advanced') {
      gaps.push(finding(
        'bloqueia',
        'subflow mode',
        `${step.name} ${name} sem mode (simple/advanced)`,
        step.name,
      ));
    }
    if (name === 'callFlow' && step.settings?.input?.flowId == null) {
      gaps.push(finding(
        'bloqueia',
        'subflow flowId',
        `${step.name} callFlow sem flowId (externalId do flow chamado)`,
        step.name,
      ));
    }
  }

  const linear = linearVariableLabels(recipe);
  const codeVars = steps.filter((step) => {
    const variable = materializedVariable(step);
    return variable && !(variable.kind === 'escalar' && linear.has(variable.label));
  });
  if (codeVars.length) {
    gaps.push(finding(
      'bloqueia',
      'variavel storage',
      `${codeVars.length} variavel(is) Workato em CODE (${codeVars.map((step) => step.name).join(', ')}); usar Storage escopo Run`,
    ));
  }
  for (const step of steps) {
    if (pieceNameOf(step) !== '@activepieces/piece-store') continue;
    const scope = step.settings?.input?.store_scope;
    if (scope !== 'RUN') {
      gaps.push(finding(
        'bloqueia',
        'variavel storage',
        `${step.name} Storage sem escopo Run`,
        step.name,
      ));
    }
    if (listWriteIsNotJsonStrings(step)) {
      gaps.push(finding(
        'bloqueia',
        'add to list',
        `${step.name} Add To List nao e lista de strings JSON`,
        step.name,
      ));
    }
  }

  const cardActions = actions.filter((action) => collapseOpKey(action.opKey).endsWith('/get_cards_by_field'));
  const openCardCode = steps.filter(
    (step) => step.type === 'CODE' && /include_done:\s*false/.test(String(step.settings?.sourceCode?.code ?? '')),
  );
  const falseCardActions = cardActions.filter((action) => includeDoneIsFalse(action.input));
  falseCardActions.forEach((action, index) => {
    const connector = steps.find(
      (step) => opNameOf(step) === 'getCardsByFieldValue'
        && !String(step.name ?? '').includes('_err')
        && step.displayName === (action.name || 'get_cards_by_field'),
    );
    if (openCardCode[index]) return;
    gaps.push(finding(
      'bloqueia',
      'cards arquivados',
      connector
        ? `${connector.name} getCardsByFieldValue com include_done false; o conector nao exclui done/archived — usar Code JS`
        : `${action.opKey} include_done false sem Code JS`,
      connector?.name ?? action.as ?? '',
    ));
  });

  return gaps;
}

export function verifyTransport({
  recipe,
  flow,
  operations = {},
  source = 'anexo',
  draftStatus = null,
  routing = null,
} = {}) {
  const tree = collectWorkatoTree(recipe);
  const trigger = flowTrigger(flow);
  const steps = walkFlowSteps(trigger);
  const todos = collectTodos(steps);
  const emptySchedules = collectEmptySchedules(steps);
  const emptyDelays = collectEmptyDelays(steps);
  const emptyFileGets = collectEmptyFileGets(steps);
  const workatoPills = collectWorkatoSchemaPills(steps);
  const undefinedPills = collectUndefinedPills(steps);
  const badCaseFormulas = collectBadCaseFormulas(steps);
  const httpPadGaps = collectHttpPadGaps(steps);
  const oneSidedCase = collectOneSidedCase(recipe, steps);
  const brokenVariables = collectBrokenVariables(steps);
  const emptyRepeats = collectEmptyRepeatSteps(steps);
  const emailGaps = collectEmailGaps(tree.actions, steps);
  const flowNotes = canvasNotes(flow);
  const { missing: missingActions, used } = findMissingActions(tree.actions, steps, operations, flowNotes, tree.controls);
  const findings = [];

  const scheduleSteps = steps.filter((step) => pieceNameOf(step) === '@activepieces/piece-schedule');
  const clock = tree.actions.find((action) => action.opKey === 'clock/scheduled_event'
    || collapseOpKey(action.opKey) === 'clock/scheduled_event');
  const triggerPiece = pieceNameOf(trigger);

  if (clock && triggerPiece && triggerPiece !== '@activepieces/piece-schedule') {
    findings.push(finding(
      'bloqueia',
      'gatilho',
      `Workato clock/scheduled_event virou ${triggerPiece}`,
      String(trigger?.name ?? 'trigger'),
    ));
  }

  const triggerOpKey = tree.trigger?.provider && tree.trigger?.name
    ? `${tree.trigger.provider}/${tree.trigger.name}`
    : '';
  const triggerMap = triggerOpKey ? lookupMap(operations, triggerOpKey) : null;
  if (
    triggerPiece === '@activepieces/piece-webhook' &&
    String(trigger?.settings?.triggerName ?? '') === 'catch_webhook' &&
    flowNotes.some((note) => String(note.content ?? '').includes(UNMAPPED_TRIGGER_PLACEHOLDER_SNIPPET)) &&
    (!triggerMap?.target || triggerMap.target.kind !== 'trigger' || triggerMap.target.name !== 'catch_webhook')
  ) {
    findings.push(finding(
      'bloqueia',
      'gatilho placeholder',
      `Gatilho Workato ${collapseOpKey(triggerOpKey)} sem equivalente; catch_webhook placeholder`,
      String(trigger?.name ?? 'trigger'),
    ));
  }

  for (const item of emptySchedules) {
    findings.push(finding('bloqueia', 'schedule vazio', `${item.step} sem cronExpression`, item.step));
  }

  for (const item of emptyDelays) {
    findings.push(finding(
      'bloqueia',
      'delay vazio',
      `${item.step} (${item.action}) ${item.reason}`,
      item.step,
    ));
  }

  for (const item of emptyFileGets) {
    findings.push(finding(
      'bloqueia',
      'get file from URL vazio',
      `${item.step} (${item.action}) ${item.reason}`,
      item.step,
    ));
  }

  for (const item of workatoPills) {
    findings.push(finding('bloqueia', 'datapill schema', `${item.step} ${item.reason}`, item.step));
  }
  for (const item of undefinedPills) {
    findings.push(finding('bloqueia', 'datapill undefined', `${item.step} ${item.reason}`, item.step));
  }
  for (const item of badCaseFormulas) {
    findings.push(finding('bloqueia', 'formula grafia', `${item.step} ${item.reason}`, item.step));
  }
  for (const item of httpPadGaps) {
    findings.push(finding('bloqueia', 'HTTP pad', `${item.step} ${item.reason}`, item.step));
  }
  for (const item of oneSidedCase) {
    findings.push(finding('bloqueia', 'formula um lado', `${item.step} ${item.reason}`, item.step));
  }
  for (const item of brokenVariables) {
    findings.push(finding('bloqueia', 'variavel vazia', `${item.step} ${item.reason}`, item.step));
  }
  for (const item of emptyRepeats) {
    findings.push(finding('bloqueia', 'repeat vazio', `${item.step} ${item.reason}`, item.step));
  }
  for (const item of emailGaps) {
    findings.push(finding('info', 'email gap', `${item.step} ${item.reason}`, item.step));
  }

  if (clock && scheduleSteps.length) {
    const expected = workatoScheduleToCron(clock.input);
    const actual = cronOf(scheduleSteps[0]);
    const tzWorkato = String(clock.input?.timezone ?? '').trim();
    const tzFlow = String(scheduleSteps[0]?.settings?.input?.timezone ?? '').trim();
    if (expected && actual && expected !== actual) {
      findings.push(finding(
        'revisar',
        'schedule diverge',
        `Workato ${expected} ≠ flow ${actual}`,
        scheduleSteps[0].name,
      ));
    }
    if (!tzFlow) {
      findings.push(finding('revisar', 'timezone', 'piece-schedule sem timezone', scheduleSteps[0].name));
    } else if (tzWorkato && tzWorkato !== tzFlow) {
      findings.push(finding(
        'revisar',
        'timezone',
        `Workato ${tzWorkato} ≠ flow ${tzFlow}`,
        scheduleSteps[0].name,
      ));
    }
    const approx = scheduleCronTodo(clock.input, actual || expected || '');
    const gated = JSON.stringify(flow).includes('agenda: a cada');
    if (approx && !gated) findings.push(finding('revisar', 'schedule aproximado', approx, scheduleSteps[0].name));
  }

  for (const item of missingActions) {
    const mappedPiece = item.piece
      ? ` — falta ${item.piece}${item.action ? `/${item.action}` : ''}`
      : '';
    findings.push(finding(
      'bloqueia',
      'action faltando',
      `${item.opKey}${item.as ? ` as ${item.as}` : ''}${mappedPiece}`,
      item.as ?? '',
    ));
  }

  const ifs = tree.controls.filter((c) => c.keyword === 'if' && !c.skip).length;
  const routers = steps.filter((s) => s.type === 'ROUTER').length;
  if (ifs > routers) {
    findings.push(finding('bloqueia', 'if sem ROUTER', `${ifs} if Workato, ${routers} ROUTER no flow`));
  }

  const loopsW = tree.controls.filter((c) => c.keyword === 'foreach' && !c.skip).length;
  const loopsF = steps.filter((s) => s.type === 'LOOP_ON_ITEMS').length;
  if (loopsW > loopsF) {
    findings.push(finding('bloqueia', 'foreach sem LOOP', `${loopsW} foreach Workato, ${loopsF} LOOP_ON_ITEMS`));
  }

  const repeats = tree.controls.filter((c) => c.keyword === 'repeat' && !c.skip).length;
  const repeatMarks = steps.filter((s) => opNameOf(s) === 'REPEAT_UNSUPPORTED').length;
  const convertedRepeats = Math.max(0, loopsF - loopsW);
  const unexplainedRepeats = repeats - repeatMarks - convertedRepeats;
  if (unexplainedRepeats > 0) {
    findings.push(
      finding(
        'revisar',
        'repeat',
        `${repeats} repeat Workato, ${repeatMarks} marcador REPEAT_UNSUPPORTED, ${convertedRepeats} LOOP_ON_ITEMS alem dos foreach`,
      ),
    );
  }

  if (tree.triggerFilter && routers === 0) {
    findings.push(finding('revisar', 'filtro do gatilho', 'filter Workato sem ROUTER no flow'));
  }

  for (const control of tree.controls.filter((c) => c.skip)) {
    findings.push(finding('info', 'desativado', `bloco ${control.keyword} skip=true na Workato; nao exige step`));
  }
  const failureSteps = steps.filter((step) => step.onFailureAction);
  const catchBodies = tree.controls.filter((c) => c.hasCatchBody);
  const catchRouters = steps.filter(
    (step) => step.type === 'ROUTER' && step.displayName === 'Catch do monitor',
  );
  const failureBranches = steps.filter((step) => step.continueOnFailureBranches?.onFailure);
  if (!failureSteps.length && !failureBranches.length && catchBodies.length > catchRouters.length) {
    findings.push(
      finding(
        'revisar',
        'CATCH',
        `try/catch com corpo sem o ramo de falha do passo (${catchRouters.length} router(s), ${catchBodies.length} bloco(s))`,
      ),
    );
  }
  const stopOnlyCatches = tree.controls.filter((control) => control.catchStopOnly);
  if (stopOnlyCatches.length) {
    const stopFlows = steps.filter(
      (step) => pieceNameOf(step) === '@activepieces/piece-flow-helper' && opNameOf(step) === 'stopFlow',
    );
    if (!stopFlows.length) {
      findings.push(finding(
        'revisar',
        'CATCH',
        'catch que so para o job sem stopFlow no ramo de falha do step',
      ));
    }
  }
  findings.push(...collectRafaGaps(recipe, flow, steps));
  if (tree.controls.some((c) => c.stopWithError) && steps.some(routerLeaksPastStop)) {
    findings.push(finding('revisar', 'STOP', 'stop_with_error sem equivalente no AP'));
  }

  for (const todo of todos) {
    let detail = `${todo.kind} em ${todo.step || '?'}`;
    if (todo.kind === 'piece TODO') {
      const step = steps.find((item) => item.name === todo.step);
      const op = step ? workatoOpForTodoStep(tree.actions, step) : '';
      if (op) detail = `piece TODO em ${todo.step}: ${op}`;
    }
    findings.push(finding(todo.severity, todo.kind, detail, todo.step));
  }

  for (const step of steps) {
    if (!isTodoPiece(step) || opNameOf(step) === 'REPEAT_UNSUPPORTED') continue;
    if (!hasCanvasNoteForTodoStep(flowNotes, step)) {
      findings.push(finding(
        'revisar',
        'TODO sem nota',
        `passo ${step.name} (${pieceNameOf(step)}/${opNameOf(step)}) sem sticky note de revisão`,
        step.name,
      ));
    }
  }

  for (const step of steps) {
    if (step.type !== 'LOOP_ON_ITEMS') continue;
    const items = String(step.settings?.items ?? '').trim();
    if (!items || items.includes('TODO')) {
      findings.push(finding('revisar', 'LOOP items', `${step.name} sem lista de itens`, step.name));
    }
  }

  const emptyProps = [];
  for (const step of steps) {
    const input = step?.settings?.input;
    if (!input || typeof input !== 'object') continue;
    const httpSend = pieceNameOf(step) === '@activepieces/piece-http'
      && String(step.settings?.actionName ?? '') === 'send_request';
    for (const [key, value] of Object.entries(input)) {
      if (!EMPTY_PROP_KEYS.has(key)) continue;
      if (httpSend && key === 'url') continue;
      if (value === '' || value == null) {
        emptyProps.push({ step: step.name, key });
        findings.push(finding('revisar', 'PROPS', `${step.name}.${key} vazio`, step.name));
      }
    }
  }

  const authGaps = [];
  for (const step of steps) {
    if (step.type !== 'PIECE' && step.type !== 'PIECE_TRIGGER') continue;
    const piece = pieceNameOf(step);
    if (!needsAuth(piece) || hasAuthRef(step)) continue;
    authGaps.push({ step: step.name, piece });
    findings.push(finding(
      source === 'live' ? 'revisar' : 'info',
      'auth',
      `${step.name} (${piece}) sem {{connections['…']}}${source === 'anexo' ? ' — anexo costuma vir sem auth' : ''}`,
      step.name,
    ));
  }

  const extraSteps = [];
  steps.forEach((step, index) => {
    if (used.has(index)) return;
    if (!step.type) return;
    if (step.name === 'trigger') return;
    if (step.type === 'ROUTER' || step.type === 'LOOP_ON_ITEMS') return;
    if (opNameOf(step) === 'REPEAT_UNSUPPORTED') return;
    if (isMigrationReviewNote(step)) return;
    extraSteps.push({ step: step.name, type: step.type, piece: pieceNameOf(step) || null });
  });
  if (extraSteps.length) {
    findings.push(finding(
      'info',
      'steps extra',
      extraSteps.map((s) => s.step).join(', '),
    ));
  }

  const invalidSteps = steps.filter((s) => s.valid === false);
  if (invalidSteps.length) {
    const names = invalidSteps.map((s) => s.name || s.displayName || '?').join(', ');
    findings.push(finding(
      'bloqueia',
      'valid:false',
      `${invalidSteps.length} action(s) com valid:false: ${names}`,
    ));
  }

  if (draftStatus && String(draftStatus).toUpperCase() === 'ENABLED') {
    findings.push(finding('revisar', 'publicado', `draft status ${draftStatus} — migracao nao publica`));
  }

  const flowName = flow?.flows?.[0]?.displayName ?? flow?.name;
  const recipeName = recipe?.name;
  if (flowName && recipeName && String(flowName).trim() !== String(recipeName).trim()) {
    findings.push(finding('info', 'nome', `receita "${recipeName}" vs flow "${flowName}"`));
  }

  if (routing?.destination === 'manual_revision') {
    const reason = String(routing.blocked_reason ?? routing.blockedReason ?? 'manual_revision').trim();
    const diags = routing.diagnostics ?? [];
    const diag = diags
      .map((d) => `${d.category ?? '?'}/${d.reason ?? '?'}`)
      .filter(Boolean)
      .join('; ');
    const detail = diag && !reason.includes(diag) ? `${reason} — ${diag}` : reason;
    const reviewOnly = diags.length > 0 && diags.every((d) => d.severity === 'REVIEW' || d.reason === 'FORMULA_REVIEW');
    findings.push(finding(reviewOnly ? 'revisar' : 'bloqueia', 'manual_revision', detail.slice(0, 500)));
  }

  const seen = new Set();
  const deduped = [];
  for (const item of findings) {
    const key = `${item.severity}|${item.kind}|${item.detail}|${item.step}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const bloqueia = deduped.filter((f) => f.severity === 'bloqueia');
  const revisar = deduped.filter((f) => f.severity === 'revisar');
  const info = deduped.filter((f) => f.severity === 'info');
  const ok = bloqueia.length === 0;
  const limpo = ok && revisar.length === 0 && todos.length === 0;

  return {
    ok,
    limpo,
    source,
    draftStatus,
    recipe: recipe?.name ?? null,
    recipeId: recipe?.id ?? null,
    workatoActions: tree.actions.length,
    flowSteps: steps.length,
    todos,
    missingActions,
    emptySchedules,
    emptyDelays,
    emptyFileGets,
    workatoPills,
    undefinedPills,
    badCaseFormulas,
    httpPadGaps,
    oneSidedCase,
    brokenVariables,
    emptyRepeats,
    emailGaps,
    missingControl: deduped.filter((f) => f.kind === 'if sem ROUTER' || f.kind === 'foreach sem LOOP'),
    extraSteps,
    authGaps,
    findings: deduped,
    bloqueia,
    revisar,
    info,
    routing: routing
      ? {
          destination: routing.destination ?? null,
          status: routing.status ?? null,
          blocked_reason: routing.blocked_reason ?? routing.blockedReason ?? null,
        }
      : null,
  };
}

function section(title, items, line) {
  if (!items.length) return [];
  const out = [`${title}:`];
  for (const item of items) out.push(`- ${line(item)}`);
  out.push('');
  return out;
}

export function formatReport(report, pipeId, { max } = {}) {
  const header = report.ok
    ? `transporte ${report.limpo ? 'limpo' : 'ok'} no pipe ${pipeId}`
    : `transporte falhou no pipe ${pipeId}`;
  const lines = [
    header,
    `fonte: ${report.source ?? 'anexo'}`,
    ...(report.draftStatus ? [`draft: ${report.draftStatus}`] : []),
    '',
    '------',
    '',
    ...section('bloqueia', report.bloqueia ?? [], (f) => f.detail),
    ...section('revisar', report.revisar ?? [], (f) => f.detail),
    ...section('info', report.info ?? [], (f) => f.detail),
  ];

  if (!report.bloqueia?.length && !report.revisar?.length && !report.info?.length) {
    lines.push('todos: nenhum');
  }

  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (max && text.length > max) {
    const keep = [];
    const rest = [];
    for (const block of text.split('\n\n')) {
      if (/^bloqueia:/.test(block) || block.startsWith('transporte ')) keep.push(block);
      else rest.push(block);
    }
    text = [...keep, ...rest].join('\n\n');
    if (text.length > max) text = `${text.slice(0, max - 2).trim()}\n…`;
  }
  return text;
}

export function formatComment(report, pipeId) {
  return formatReport(report, pipeId, { max: 1000 });
}

export function formatChat(report, pipeId) {
  return formatReport(report, pipeId);
}
