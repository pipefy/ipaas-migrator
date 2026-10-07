// Constroi um export Activepieces a partir da receita Workato parseada.
// Schema calibrado contra um flow real exportado (schemaVersion "20").
// Marca com TODO tudo que exige revisao (Ruby, formulas complexas, ops nao mapeadas).

import type {
  Kb,
  MapEntry,
  MapTarget,
  ParsedStep,
  ParsedRecipe,
  PipePhase,
  SlimPiece,
  WorkatoCondition,
  WorkatoConditionsInput,
} from './types.ts';
import { collapseOpKey, lookupMap } from './collapse.ts';
import { OMIE_APP_KEY, OMIE_APP_SECRET, omieActionName, omieHttpInput } from './omie-http.ts';
import { csvParseCode, csvParsePlan } from './csv-parse.ts';
import { wrapJsEvalMain } from './js-eval.ts';
import { isXlsxToCsvPython, xlsxSheetName, xlsxToCsvPureCode } from './xlsx-csv.ts';
import { resolveZeroPhaseInput } from './phase-id.ts';
import { PIPEFY_PIECE_VERSION, pipefyPropertySettings, updateListFieldFromGraphql, withPipefyCardFields } from './pipefy-piece.ts';
import {
  dynamicPropertySettings,
  resultLabelsFromSchema,
  shapeCallFlow,
  shapeCallableFlow,
  shapeReturnResponse,
  SUBFLOW_PIECE_VERSION,
} from './subflow.ts';
import { parseRubyRandomSleep, randomSleepCode, resolveRubySleep, resolveWaitUntilTime } from './delay.ts';
import {
  convertPills,
  detectRubyMethods,
  isRubyExpression,
  parseIncludeFormula,
  peelTrailingCaseMethod,
  CATCH_ERROR_TOKEN,
  stepBindingName,
  wrapApCase,
  bracketizePills,
  type JobContextHits,
  type StepBinding,
  type StepNameMap,
} from './datapills.ts';
import {
  compileRubyExpression,
  CURRENCY_NOTE,
  DECODE_B64_NOTE,
  EQ_NOTE,
  MULTIPLY_NOTE,
  PHONE_NOTE,
  newBindingRegistry,
  renderHelpers,
  type BindingRegistry,
} from './ruby-expr.ts';
import { scheduleCronTodo, workatoScheduleToCron } from './schedule-cron.ts';
import {
  firstPill,
  indexVariables,
  parseVarName,
  readsOf,
  scalarFieldReads,
  scalarStorageKey,
  SOURCE_KEY,
  variableOp,
  type VarDecl,
  type VarIndex,
} from './variables.ts';
import {
  listBatchCode,
  listBatchFields,
  listItemJson,
  listReadCode,
  storeGetRef,
  writtenFields,
  FIELDS_KEY,
  SOURCE_INPUT_KEY,
  STORE_PIECE,
  STORE_SCOPE,
} from './variable-steps.ts';

export interface BuildResult {
  flow: any; // wrapper de export do AP
  todos: string[];
}

interface LoopScope {
  /** template da colecao iterada, ex. `{{step_3.nodes}}`. */
  collection: string;
  /** referencia do item, ex. `loop_2.item`. */
  item: string;
}

interface Ctx {
  merged: Record<string, MapEntry>;
  kb: Map<string, SlimPiece>;
  asToName: StepNameMap;
  /** `as` de passos `skip: true` — convertPills nao emite pill para eles. */
  skippedAs: Set<string>;
  /** `as` de workato_list que um foreach percorre. */
  loopedListLines: Set<string>;
  /**
   * Foreach abertos no ponto atual da construcao, de fora para dentro. Pills de
   * "item atual" resolvem contra o mais interno que itera aquela colecao.
   */
  loopScope: LoopScope[];
  piecesUsed: Set<string>;
  todos: string[];
  canvasNotes: PendingCanvasNote[];
  /** Nota de update vazio ainda sem passo seguinte para ancorar. */
  noteAnchorPending?: number;
  /** Nome e id da receita, para pills `job_context` que não apontam para um passo. */
  recipeName: string;
  recipeId?: string;
  jobContextHits: JobContextHits;
  jobContextNoted: JobContextHits;
  counter: { n: number };
  /**
   * Steps CODE de formula criados para o step que esta sendo montado. Quem
   * monta a cadeia (buildChain / gateOnTriggerFilter) os encadeia ANTES dele.
   */
  pendingCode: any[];
  /** Variaveis Workato da receita e a estrategia escolhida para cada uma. */
  vars: VarIndex;
  /** Labels do result_schema da recipe function, para o returnResponse. */
  subflowResultLabels: Map<string, string>;
  /** Fases do schema Workato, para trocar phase_id "0" pelo id do formulário inicial. */
  phasesByPipe: PipePhase[];
  connectionsByProvider: Record<string, string>;
  /** Variavel iPaaS (`CLIENT_ID`) → origem (propriedade de projeto, token, Omie). */
  projectVariables: Map<string, string>;
  /** Ids de data table Workato que já ganharam sticky note neste flow. */
  notedDataTableIds: Set<string>;
}

interface PendingCanvasNote {
  id: string;
  kind: 'CATCH' | 'STOP' | 'JOB' | 'SECRET' | 'FORMULA' | 'SUBFLOW' | 'EMAIL' | 'SMS' | 'SCHEDULE' | 'UPDATE' | 'CONNECTION' | 'MODAL' | 'VARS' | 'REPEAT' | 'LOOKUP' | 'TABLE' | 'TEMPLATE' | 'SOAP' | 'GRAPHQL' | 'MAPPER';
  content: string;
  anchorStepName?: string;
}

/** Sentinel for piece/action/trigger names the transpiler could not resolve. */
const TODO_PIECE = 'TODO';

const PIPEFY_PIECE = '@activepieces/piece-pipefy';
const SUBFLOW_PIECE = '@activepieces/piece-subflows';
const PIPEFY_PAYLOAD_ROOT = 'data';
const PIPEFY_GET_CARD_PAYLOAD_ROOT = 'data.card';

function pipefyOutputRoot(targetName: string | undefined): string {
  return targetName === 'getCardById' ? PIPEFY_GET_CARD_PAYLOAD_ROOT : PIPEFY_PAYLOAD_ROOT;
}

function bindAs(ctx: Ctx, as: string | undefined, name: string, step: ParsedStep): void {
  if (!as) return;
  const opKey = step.opKey ?? (step.provider && step.name ? `${step.provider}/${step.name}` : undefined);
  const collapsed = opKey ? collapseOpKey(opKey) : undefined;
  if (collapsed === 'workato_list/create_list') {
    ctx.asToName.set(as, { name, headAlias: { from: 'list', to: 'items' } });
    return;
  }
  if (collapsed === 'workato_list/accumulate_list_items' && ctx.loopedListLines.has(as)) {
    ctx.asToName.set(as, { name, headAlias: { from: 'list_items', to: 'items' } });
    return;
  }
  const target = opKey ? lookupMap(ctx.merged, opKey)?.target : undefined;
  const cardsByField =
    target?.name === 'getCardsByFieldValue' && !includeDoneIsFalse(step.input ?? {});
  ctx.asToName.set(
    as,
    target?.piece === PIPEFY_PIECE
      ? {
          name,
          outputRoot: pipefyOutputRoot(target.name),
          ...(cardsByField ? { actionName: 'getCardsByFieldValue' as const } : {}),
        }
      : name,
  );
}

/**
 * `actionName` do marcador de `repeat`/`while`. Compartilha o `pieceName: TODO`
 * (o step tem de ficar invalido), mas se distingue de uma operacao que faltou
 * mapear: aqui a limitacao e da plataforma, o AP so itera colecao.
 */
/** resolve pill de "item atual" contra o foreach mais interno da colecao. */
function loopItemResolver(ctx: Ctx) {
  return (collection: string): string | undefined => {
    for (let i = ctx.loopScope.length - 1; i >= 0; i--) {
      if (ctx.loopScope[i]!.collection === collection) return ctx.loopScope[i]!.item;
    }
    ctx.todos.push(
      `LISTA (${collection}): pill de "item atual" sem foreach correspondente; ` +
        'traduzida como primeiro item ([0]), igual ao Workato. Conferir se era para iterar.',
    );
    return undefined;
  };
}

function pills(input: string, ctx: Ctx, resolve = loopItemResolver(ctx)): string {
  return convertPills(input, ctx.asToName, resolve, {
    recipeName: ctx.recipeName,
    recipeId: ctx.recipeId,
    jobContextHits: ctx.jobContextHits,
    skippedAs: ctx.skippedAs,
    projectVariables: ctx.projectVariables,
  });
}

const ERR = () => ({
  retryOnFailure: { value: false },
  continueOnFailure: { value: false },
});

const FLOW_HELPER_PIECE = '@activepieces/piece-flow-helper';

function isFallibleStep(step: any): boolean {
  return step?.type === 'PIECE' || step?.type === 'CODE';
}

// lastUpdatedDate e obrigatorio (z.string()) em trigger e em cada step (schema AP).
let NOW = '1970-01-01T00:00:00.000Z';

function pieceVersion(ctx: Ctx, pieceName: string): string {
  if (pieceName === PIPEFY_PIECE) return PIPEFY_PIECE_VERSION;
  if (pieceName === SUBFLOW_PIECE) return SUBFLOW_PIECE_VERSION;
  return ctx.kb.get(pieceName)?.version ?? '~latest';
}

/** propertySettings: cada input vira {type:'MANUAL'} (como no export real). */
function propertySettings(input: Record<string, any>): Record<string, any> {
  const ps: Record<string, any> = {};
  for (const k of Object.keys(input)) ps[k] = { type: 'MANUAL' };
  return ps;
}

function subflowPropertySettings(actionName: string, input: Record<string, any>): Record<string, any> {
  const ps = propertySettings(input);
  if (actionName === 'callFlow' && input.flowProps?.payload && typeof input.flowProps.payload === 'object') {
    const defaultValue: Record<string, string> = {};
    for (const key of Object.keys(input.flowProps.payload)) defaultValue[key] = '1234';
    ps.flowProps = dynamicPropertySettings('flowProps', 'payload', 'Payload', defaultValue);
  }
  if (actionName === 'callableFlow') {
    ps.exampleData = dynamicPropertySettings('exampleData', 'sampleData', 'Sample Data');
  }
  if (actionName === 'returnResponse') {
    ps.response = dynamicPropertySettings('response', 'response', 'Response');
  }
  return ps;
}

function settingsFor(pieceName: string, actionName: string, input: Record<string, any>): Record<string, any> {
  return pieceName === SUBFLOW_PIECE ? subflowPropertySettings(actionName, input) : propertySettings(input);
}

function applySubflowAction(
  opKey: string,
  actionName: string,
  sourceInput: Record<string, any>,
  ctx: Ctx,
  name: string,
): Record<string, any> | null {
  if (!opKey.includes('recipe_function/')) return null;
  if (actionName === 'callFlow') {
    const asyncCall = opKey.endsWith('/call_recipe_async');
    const shaped = shapeCallFlow(sourceInput, asyncCall);
    if (shaped.flowIdNote) {
      ctx.todos.push(`SUBFLOW (${name}): ${shaped.flowIdNote}`);
      pushReviewNote(ctx, 'SUBFLOW', shaped.flowIdNote, '', name);
    }
    shaped.input.flowProps = resolveFormulas(deepConvert(shaped.input.flowProps, ctx), ctx, name, sourceInput.parameters);
    return shaped.input;
  }
  if (actionName === 'returnResponse') {
    const shaped = shapeReturnResponse(sourceInput, ctx.subflowResultLabels);
    shaped.response = resolveFormulas(deepConvert(shaped.response, ctx), ctx, name, sourceInput.result);
    return shaped;
  }
  return null;
}

/** `input` de if/elsif/while_condition e `filter` do trigger, sem assumir formato. */
function asConditionsInput(value: unknown): WorkatoConditionsInput | undefined {
  return value && typeof value === 'object' ? (value as WorkatoConditionsInput) : undefined;
}

function conditionsOf(input: WorkatoConditionsInput | undefined): WorkatoCondition[] {
  return Array.isArray(input?.conditions) ? input.conditions : [];
}

/** `as` do declare que este passo escreve, se ele for uma escrita de variavel. */
function writtenVariable(step: ParsedStep, ctx: Ctx): VarDecl | undefined {
  const op = variableOp(step);
  if (!op) return undefined;
  const as = op === 'declare' ? step.as : parseVarName(step.input?.name)?.declareAs;
  return as ? ctx.vars.decls.get(as) : undefined;
}

/**
 * pre-pass: nomeia cada action/trigger (resolve data pills por `as`) e anota,
 * em cada passo, qual step carrega o valor atual de cada variavel `linear`.
 *
 * `varState` e atualizado DEPOIS de tirar o snapshot: a propria escrita precisa
 * enxergar o valor anterior para fazer o merge.
 */
function assignNames(
  step: ParsedStep,
  ctx: Ctx,
  isRoot: boolean,
  varState: Map<string, string> = new Map(),
): void {
  if (step.skip && step.as) ctx.skippedAs.add(step.as);

  if (isRoot) {
    step.apName = 'trigger';
    bindAs(ctx, step.as, 'trigger', step);
  } else if (step.keyword === 'foreach') {
    step.apName = `loop_${ctx.counter.n++}`;
    if (step.as) ctx.asToName.set(step.as, `${step.apName}.item`);
  } else if (step.keyword === 'if') {
    step.apName = `router_${ctx.counter.n++}`;
  } else if (step.keyword === 'repeat') {
    // Sem equivalente no AP, mas o `as` precisa de nome: o corpo referencia
    // `<as>.index`, e sem registro isso vazaria o hash cru no template.
    step.apName = `repeat_${ctx.counter.n++}`;
    if (step.as) ctx.asToName.set(step.as, step.apName);
  } else if (step.opKey && (step.keyword === 'action' || step.keyword === 'trigger')) {
    step.apName = `step_${ctx.counter.n++}`;
    bindAs(ctx, step.as, step.apName, step);
  }

  if (varState.size) step.varSnapshot = new Map(varState);
  const written = step.skip ? undefined : writtenVariable(step, ctx);
  if (written?.strategy === 'linear' && step.apName) varState.set(written.as, step.apName);

  step.children.forEach((c) => assignNames(c, ctx, false, varState));
}

function deepConvert(val: any, ctx: Ctx): any {
  if (typeof val === 'string') return pills(val, ctx);
  if (Array.isArray(val)) return val.map((v) => deepConvert(v, ctx));
  if (val && typeof val === 'object') {
    const o: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) o[k] = deepConvert(v, ctx);
    return o;
  }
  return val;
}

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function operationDef(ctx: Ctx, target: MapTarget | null | undefined) {
  if (!target) return undefined;
  const piece = ctx.kb.get(target.piece);
  const pool = target.kind === 'trigger' ? piece?.triggers : piece?.actions;
  return pool?.find((operation) => operation.name === target.name);
}

/** props validas (nomes) da action/trigger alvo, via KB. */
function validPropsOf(ctx: Ctx, target?: MapTarget | null): Set<string> {
  const set = new Set<string>();
  operationDef(ctx, target)?.props.forEach((prop) => set.add(prop.name));
  return set;
}

function targetPropTypes(ctx: Ctx, target?: MapTarget | null): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  operationDef(ctx, target)?.props.forEach((prop) => result.set(prop.name, prop.type));
  return result;
}

function missingRequiredProps(ctx: Ctx, target: MapTarget, input: Record<string, any>): string[] {
  return (operationDef(ctx, target)?.props ?? [])
    .filter((prop) => prop.required && (input[prop.name] === undefined || input[prop.name] === ''))
    .map((prop) => prop.name);
}

/** Props que a receita Workato não traz nesse formato. Não inventa valor. */
function waivedMissing(
  target: MapTarget,
  input: Record<string, any>,
  sourceInput: Record<string, any>,
  missing: string[],
): string[] {
  let out = missing;
  if (target.piece === '@activepieces/piece-google-drive' && target.name === 'update_permissions') {
    const type = String(sourceInput.type ?? '').trim().toLowerCase();
    if (type === 'anyone' || type === 'domain') out = out.filter((name) => name !== 'user_email');
  }
  if (
    target.piece === PIPEFY_PIECE &&
    target.name === 'updateCard' &&
    !blankProp(input.cardId) &&
    !phaseFieldsBlank(input.phaseFields)
  ) {
    out = out.filter((name) => name !== 'organizationId' && name !== 'pipeId' && name !== 'phaseId');
  }
  if (target.piece === PIPEFY_PIECE && (target.name === 'cardFieldUpdated' || target.name === 'recordFieldUpdated')) {
    const raw = sourceInput.field_ids;
    if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
      out = out.filter((name) => name !== 'fieldIds');
    }
  }
  return out;
}

function normalizeTargetValue(value: any, propType?: string, src?: string): any {
  if (src === 'api_call' || src === 'input' || src === 'input.data') return asAdhocBody(value);
  if (src === 'verb' && typeof value === 'string') return value.toUpperCase();
  if (src === 'action' || propType === 'CHECKBOX') return asEnableFlag(value);
  if (src === 'attachments' && value && typeof value === 'object' && !Array.isArray(value)) {
    return [value];
  }
  const asList = Boolean(propType?.includes('MULTI_SELECT') || propType === 'ARRAY');
  if (!asList || Array.isArray(value)) return value;
  if (typeof value !== 'string') return [value];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

/** Workato `input` / `input.data` do HTTP ad-hoc: o GraphQL mora em `data`. */
function asAdhocBody(value: any): any {
  let payload = value;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload) {
    payload = payload.data;
  }
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.startsWith('{') && /"query"\s*:/.test(trimmed)) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return asGraphqlBody(payload);
      }
    }
  }
  return asGraphqlBody(payload);
}

/** `"true"` / `Enable` / pick-list `{action}` -> checkbox da piece. */
function asEnableFlag(value: any): any {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const inner = value.action ?? value.value ?? value.label;
    if (inner !== undefined) return asEnableFlag(inner);
  }
  const flag = String(value).trim().toLowerCase();
  if (['true', 'enable', 'enabled', 'yes', '1'].includes(flag)) return true;
  if (['false', 'disable', 'disabled', 'no', '0'].includes(flag)) return false;
  return value;
}

/** Workato `api_call` e o documento GraphQL; a piece espera `{query}`. */
function asGraphqlBody(value: any): any {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && /"query"\s*:/.test(trimmed)) return value;
  return { query: value };
}

/**
 * Props `DynamicProperties` guardam o valor dentro da sub-prop que o AP gera:
 * em runtime le `url['url']` e `body['data']`. Valor fora desse envelope e
 * trocado pelo default quando o step abre no editor (o campo aparece vazio) e
 * ignorado em runtime.
 */
const DYNAMIC_ENVELOPE: Record<string, string> = { url: 'url', body: 'data' };

/** metodos em que o AP desabilita `body_type` (e, com ele, o campo de body). */
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

function looksLikeJson(value: any): boolean {
  if (value && typeof value === 'object') return true;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Aninha as props dinamicas e escolhe o `body_type` correspondente ao payload.
 * Sem `body_type` o AP nao renderiza campo de body nenhum, entao emitir o body
 * sozinho perderia o payload. Envelopa sempre: valor vindo da receita e um
 * payload Workato, mesmo quando a unica chave dele por acaso e `data`.
 */
function envelopeDynamicProps(out: Record<string, any>, ctx: Ctx, target?: MapTarget | null): void {
  const types = targetPropTypes(ctx, target);
  for (const [prop, key] of Object.entries(DYNAMIC_ENVELOPE)) {
    if (types.get(prop) !== 'DYNAMIC' || out[prop] === undefined) continue;
    out[prop] = { [key]: out[prop] };
  }

  if (types.get('body') !== 'DYNAMIC' || out.body === undefined) return;
  const method = typeof out.method === 'string' ? out.method.toUpperCase() : '';
  if (BODYLESS_METHODS.has(method)) {
    delete out.body_type;
    ctx.todos.push(
      `BODY (${target?.piece ?? '?'}/${target?.name ?? '?'}): a receita manda body em ${method}, ` +
        'metodo em que o Activepieces desabilita o campo — conferir o payload antes de abrir o step.',
    );
    return;
  }
  if (!types.has('body_type')) return;
  if (out.body_type === undefined) out.body_type = looksLikeJson(out.body.data) ? 'json' : 'raw';
}

/**
 * Monta o input do Activepieces:
 *  - propMap com chave em dot-path (ex. "request.url") le do input aninhado.
 *  - com propMap: emite os campos mapeados + carrega chaves que ja sejam props
 *    validas da piece (via KB), descartando ruido so-do-Workato.
 *  - sem propMap: converte tudo (menos =skip).
 */
function convInput(
  input: Record<string, any>,
  entry: MapEntry | undefined,
  ctx: Ctx,
): Record<string, any> {
  const out: Record<string, any> = {};
  const map = entry?.propMap ?? {};
  const fixed = entry?.fixedProps ?? {};
  const compose = entry?.composeProps ?? {};
  const hasMap =
    Object.keys(map).length > 0 || Object.keys(fixed).length > 0 || Object.keys(compose).length > 0;
  const targetTypes = targetPropTypes(ctx, entry?.target);

  if (!hasMap) {
    for (const [k, v] of Object.entries(input)) {
      if (v === '=skip') continue;
      out[k] = deepConvert(v, ctx);
    }
    envelopeDynamicProps(out, ctx, entry?.target);
    return out;
  }

  // 1) campos mapeados (suporta dot-path na origem)
  const consumedRoots = new Set<string>();
  for (const [src, apProp] of Object.entries(map)) {
    const v = getPath(input, src);
    if (v === undefined || v === '=skip') continue;
    // Normaliza o wrapper GraphQL/HTTP antes das pills: o `_dp` mora dentro
    // da string `query` e, com o JSON ainda escapado, o parse da pill falha.
    out[apProp] = deepConvert(
      normalizeTargetValue(v, targetTypes.get(apProp), src),
      ctx,
    );
    consumedRoots.add(src.split('.')[0]!);
  }
  for (const [apProp, value] of Object.entries(fixed)) {
    out[apProp] = deepConvert(value, ctx);
  }
  for (const [apProp, spec] of Object.entries(compose)) {
    const parts: string[] = [];
    for (const src of spec.parts) {
      const v = getPath(input, src);
      if (v === undefined || v === '=skip' || v === '') continue;
      const converted = deepConvert(v, ctx);
      if (typeof converted === 'string') parts.push(converted);
      consumedRoots.add(src.split('.')[0]!);
    }
    if (parts.length) out[apProp] = parts.join(spec.separator ?? '');
  }

  // 2) carrega chaves que ja sao props validas da piece (nao mapeadas nem consumidas)
  const valid = validPropsOf(ctx, entry?.target);
  for (const [k, v] of Object.entries(input)) {
    if (v === '=skip' || consumedRoots.has(k) || k in out) continue;
    if (valid.has(k)) out[k] = deepConvert(v, ctx);
  }

  // Workato custom connectors expose dynamic Pipefy fields as top-level input
  // keys. Activepieces groups those fields under phaseFields/startFormFields.
  if (entry?.collectRemainingTo) {
    const ignored = new Set(entry.ignoreSourceProps ?? []);
    const collected: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === '=skip' || consumedRoots.has(k) || valid.has(k) || ignored.has(k)) continue;
      collected[k] = deepConvert(v, ctx);
    }
    if (Object.keys(collected).length) out[entry.collectRemainingTo] = collected;
  }
  envelopeDynamicProps(out, ctx, entry?.target);
  return out;
}

let nameSeq = 0;
const nextName = (prefix: string) => `${prefix}_${++nameSeq}`;

function appendToChain(head: any | undefined, tail: any | undefined): any | undefined {
  if (!head) return tail;
  let last = head;
  while (last.nextAction) last = last.nextAction;
  last.nextAction = tail;
  return head;
}

/**
 * Distribui a cadeia que vem depois do `if` nos ramos que NAO terminam em
 * `stop`. Com um unico ramo aberto (caso comum: `if ... stop` + `else`) a
 * semantica fica preservada. Com mais de um ramo aberto seria preciso duplicar
 * a cadeia — anexa no primeiro e avisa em vez de gerar nomes de step repetidos.
 */
function placeRestInOpenBranches(router: any, stops: boolean[], rest: any, ctx: Ctx): void {
  const open = stops.map((stopped, index) => (stopped ? -1 : index)).filter((index) => index >= 0);

  if (!open.length) {
    ctx.todos.push(
      `ROUTER (${router.name}): todos os ramos terminam em "stop" — os passos seguintes da receita nunca rodavam.`,
    );
    return;
  }
  router.children[open[0]!] = appendToChain(router.children[open[0]!], rest) ?? null;
  if (open.length > 1) {
    ctx.todos.push(
      `ROUTER (${router.name}): a cadeia depois do "if" tambem se aplica aos ramos ${open.slice(1).join(', ')} — duplicar manualmente.`,
    );
  }
}

/**
 * Encadeia os steps CODE de formula criados para `built` imediatamente antes
 * dele. Consome a fila: cada step resolve as suas proprias formulas.
 */
function prependPendingCode(built: any, ctx: Ctx, from = 0): any {
  const pending = ctx.pendingCode.splice(from);
  if (!pending.length) return built;
  let head = pending[0];
  for (const step of pending.slice(1)) appendToChain(head, step);
  appendToChain(head, built);
  return head;
}

function buildChain(children: ParsedStep[], ctx: Ctx): any | undefined {
  const steps: any[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const mark = ctx.pendingCode.length;
    const rawBuilt = buildStep(child, ctx);
    const built = rawBuilt ? prependPendingCode(rawBuilt, ctx, mark) : rawBuilt;
    // `stop` encerra este bloco. O passo emitido é stopFlow e os irmãos seguintes não entram.
    if (child.keyword === 'stop' && !child.skip) {
      if (built) steps.push(built);
      break;
    }

    if (!built) continue;
    const pendingNote = ctx.noteAnchorPending;
    if (pendingNote != null && ctx.canvasNotes[pendingNote] && !ctx.canvasNotes[pendingNote]!.anchorStepName) {
      ctx.canvasNotes[pendingNote]!.anchorStepName = built.name;
      ctx.noteAnchorPending = undefined;
    }
    steps.push(built);

    // `stop` do Workato encerra o job inteiro. Se algum ramo para, os passos
    // seguintes so rodam nos caminhos que NAO param.
    // O resto entra no ROUTER, nao no head da cadeia (que pode ser o CODE das
    // formulas do proprio router).
    if (rawBuilt.type === 'ROUTER' && child.keyword === 'if') {
      const stops = branchStopFlags(child);
      if (!stops.some(Boolean)) continue;

      const rest = buildChain(children.slice(i + 1), ctx);
      if (rest) placeRestInOpenBranches(rawBuilt, stops, rest, ctx);
      break;
    }

    // O que vem depois do try só entra no sucesso. nextAction rodaria também na falha.
    if (child.keyword === 'try' && hasActiveCatch(child)) {
      const rest = buildChain(children.slice(i + 1), ctx);
      if (rest) attachRestToSuccessTails(built, rest, ctx);
      break;
    }
  }
  // Encadeia no FIM de cada trecho, nao na raiz: `try` e `repeat` devolvem uma
  // cadeia com varios passos, e atribuir `nextAction` direto truncava tudo
  // depois do primeiro.
  for (let i = 0; i < steps.length - 1; i++) appendToChain(steps[i], steps[i + 1]);
  return steps[0];
}

/** formulas Workato (`=now + 24.hours`) que precisam de traducao manual. */
function collectFormulas(value: any, path: string, out: string[]): void {
  if (typeof value === 'string') {
    if (isRubyExpression(value)) out.push(`${path || 'campo'}="${value}"`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFormulas(item, `${path}[${index}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectFormulas(item, path ? `${path}.${key}` : key, out);
    }
  }
}

/**
 * Metodo Ruby que sobreviveu a conversao (ex. `&.pluck('id')`). O `=` inicial
 * ja foi removido a essa altura, entao `isRubyExpression` nao o reconhece mais —
 * o que resta e procurar a chamada em si.
 */
function collectResidualRubyMethods(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    const methods = detectRubyMethods(value);
    if (methods.length) out.push(`${path || 'campo'} (${methods.join(', ')})`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectResidualRubyMethods(item, `${path}[${index}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectResidualRubyMethods(item, path ? `${path}.${key}` : key, out);
    }
  }
}

/**
 * Marcadores TODO_ que sobraram no input convertido (pill sem equivalente,
 * formula nao traduzida). Geram todo/nota; `valid` do step PIECE mapeado
 * segue so as props obrigatorias da piece (mesmo nome).
 */
function collectTodoMarkers(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes('TODO_')) out.push(path || 'campo');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTodoMarkers(item, `${path}[${index}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectTodoMarkers(item, path ? `${path}.${key}` : key, out);
    }
  }
}

/**
 * Passo desativado na receita (`skip: true`). Nao executa no Workato, e migrar
 * como ativo faria o flow rodar justamente o que o autor desligou.
 *
 * Nao emite o step. `skip` no AP nao desliga de verdade: o passo ainda entra
 * no canvas (HTTP send_request sem url, valid:false). Bloco de controle
 * desativado sai inteiro, com TODO DESATIVADO.
 */
const CONTROL_FLOW_KEYWORDS = new Set([
  'if', 'elsif', 'elseif', 'else', 'foreach', 'repeat', 'while_condition', 'try', 'catch',
]);

function buildSkipped(step: ParsedStep, ctx: Ctx): any | null {
  if (CONTROL_FLOW_KEYWORDS.has(step.keyword)) {
    ctx.todos.push(
      `DESATIVADO (${step.comment || step.keyword}): bloco \`${step.keyword}\` estava ` +
        'desligado na receita e nao foi migrado.',
    );
  }
  return null;
}

/** Step `store/get`, encadeado ANTES do passo que le a variavel. */
function injectStoreGet(key: string, label: string, ctx: Ctx): string {
  const name = nextName('var_get');
  const input = { key, store_scope: STORE_SCOPE };
  ctx.piecesUsed.add(STORE_PIECE);
  ctx.pendingCode.push({
    name,
    skip: false,
    type: 'PIECE',
    valid: true,
    settings: {
      input,
      pieceName: STORE_PIECE,
      actionName: 'get',
      pieceVersion: pieceVersion(ctx, STORE_PIECE),
      propertySettings: propertySettings(input),
      errorHandlingOptions: ERR(),
    },
    displayName: `Ler variavel "${label}"`,
    lastUpdatedDate: NOW,
  });
  return name;
}

/**
 * Para onde as pills de variavel deste passo devem apontar.
 *
 * `linear` vem do snapshot do pre-pass. `store` precisa de um `get` antes do
 * passo — um por variavel, mesmo que ela apareca varias vezes no input.
 */
function variableOverlay(step: ParsedStep, ctx: Ctx): Map<string, StepBinding> | null {
  if (!ctx.vars.decls.size) return null;
  const overlay = new Map<string, StepBinding>(step.varSnapshot ?? []);

  const reads = readsOf(step);
  const fieldsByAs = scalarFieldReads(step);
  // As condicoes de `elsif` sao avaliadas no proprio router, mas moram nos
  // filhos: sem varrer aqui, a leitura delas ficaria sem `get`.
  if (step.keyword === 'if') {
    for (const child of step.children) {
      if (child.keyword !== 'elsif' && child.keyword !== 'elseif') continue;
      for (const as of readsOf(child)) reads.add(as);
      for (const [as, fields] of scalarFieldReads(child)) {
        const set = fieldsByAs.get(as) ?? new Set<string>();
        for (const field of fields) set.add(field);
        fieldsByAs.set(as, set);
      }
    }
  }

  for (const as of reads) {
    const decl = ctx.vars.decls.get(as);
    if (!decl) continue;
    if (decl.kind === 'list') {
      const getName = storeGetRef(injectStoreGet(decl.storeKey, decl.label, ctx));
      overlay.set(as, { name: getName, stripHead: 'list_items' });
      continue;
    }
    const fields = fieldsByAs.get(as);
    if (!fields?.size) continue;
    const scalarFields = new Map<string, string>();
    for (const field of fields) {
      scalarFields.set(field, storeGetRef(injectStoreGet(scalarStorageKey(field), field, ctx)));
    }
    overlay.set(as, { name: scalarFields.values().next().value!, scalarFields });
  }
  return overlay.size ? overlay : null;
}

function withOverlay<T>(ctx: Ctx, overlay: Map<string, StepBinding> | null, build: () => T): T {
  if (!overlay) return build();
  const saved = new Map<string, StepBinding | undefined>();
  for (const [as, name] of overlay) {
    saved.set(as, ctx.asToName.get(as));
    ctx.asToName.set(as, name);
  }
  try {
    return build();
  } finally {
    for (const [as, previous] of saved) {
      if (previous === undefined) ctx.asToName.delete(as);
      else ctx.asToName.set(as, previous);
    }
  }
}

function buildStep(step: ParsedStep, ctx: Ctx): any | null {
  return withOverlay(ctx, variableOverlay(step, ctx), () => buildStepInner(step, ctx));
}

function buildStepInner(step: ParsedStep, ctx: Ctx): any | null {
  if (step.skip) return buildSkipped(step, ctx);

  switch (step.keyword) {
    case 'action':
      return buildAction(step, ctx);
    case 'if':
      return buildRouter(step, ctx);
    case 'elsif':
    case 'elseif':
      return null; // agrupado como ramo do router do `if`
    case 'else':
      return null; // agrupado no if anterior
    case 'foreach':
      return buildLoop(step, ctx);
    case 'repeat':
      return buildRepeat(step, ctx);
    case 'while_condition':
      return null; // declara a saida do `repeat`, nao e acao
    case 'comment':
      return null;
    case 'try':
      return buildTry(step, ctx);
    case 'catch':
      return null;
    case 'stop':
      if (step.skip) return null;
      return stopFlowStep(ctx);
    default:
      // keyword desconhecida sem piece: comentario / wrapper. Encadeia filhos, nao emite TODO.
      if (!step.provider && !step.name) {
        return buildChain(step.children, ctx) ?? null;
      }
      return buildAction(step, ctx);
  }
}

function stepName(step: ParsedStep, ctx: Ctx): string {
  return step.apName || stepBindingName(step.as ? ctx.asToName.get(step.as) : undefined) || nextName('step');
}

/**
 * Stub do step CODE. Embute o Ruby original (quando houver) como comentario,
 * com marcador AP-MIGRATION-TODO para a LLM da skill traduzir para JS.
 */
function codeLanguage(opKey: string): string {
  if (opKey.endsWith('/invoke_custom_py_code')) return 'Python';
  if (opKey.endsWith('/invoke_custom_js_code')) return 'JavaScript';
  if (opKey.endsWith('/invoke_custom_ruby_code')) return 'Ruby';
  return 'Workato';
}

function buildCodeStub(opKey: string, source: string, language = codeLanguage(opKey)): string {
  if (source.trim()) {
    const commented = source.split('\n').map((l) => ` * ${l}`).join('\n');
    const tag = language.toUpperCase();
    return [
      '/**',
      ` * AP-MIGRATION-TODO: traduzir o ${language} (Workato "${opKey}") para JavaScript.`,
      ' * Formato Activepieces: use `inputs.<campo>` (chaves de settings.input) e RETORNE o resultado final.',
      ' *',
      ` * --- ${tag} ORIGINAL (Workato) ---`,
      commented,
      ` * --- FIM ${tag} ---`,
      ' */',
      'export const code = async (inputs) => {',
      `  // TODO(LLM): implementar o equivalente do ${language} acima.`,
      '  return inputs;',
      '};',
    ].join('\n');
  }
  return [
    `// AP-MIGRATION-TODO: implementar em JS a logica Workato "${opKey}".`,
    '// Use inputs.<campo> (chaves de settings.input) e retorne o resultado.',
    'export const code = async (inputs) => {',
    '  return inputs;',
    '};',
  ].join('\n');
}

interface Harvest {
  /** Nome do step CODE, sorteado so quando ha formula de fato para traduzir. */
  name: () => string;
  registry: BindingRegistry;
  fields: { key: string; ruby: string; expr: string }[];
  helpers: Set<string>;
  approximations: string[];
  /** Formulas que o compilador recusou. Preferimos o texto da receita. */
  uncompiled: string[];
}

/**
 * Troca cada `TODO_FORMULA(...)` residual por `{{<formula_N>.fX}}` e acumula a
 * expressao JS equivalente. O que o compilador nao entende fica como estava —
 * marcador visivel vale mais que valor errado em silencio.
 */
function replaceResidualRuby(value: any, harvest: Harvest, source: any): any {
  if (typeof value === 'string') {
    const wrapped = value.match(/^TODO_FORMULA\((.*)\)$/s);
    if (!wrapped) return value;
    const compiled = compileRubyExpression(wrapped[1]!, harvest.registry);
    if (!compiled) {
      const original = typeof source === 'string' && source.trim() ? source.trim() : wrapped[1]!;
      harvest.uncompiled.push(original);
      return value;
    }
    if (compiled.constant) {
      harvest.approximations.push(...compiled.approximations);
      const evaluated = compiled.value;
      if (evaluated === null || evaluated === undefined) return '';
      return evaluated;
    }
    const key = `f${harvest.fields.length + 1}`;
    harvest.fields.push({ key, ruby: wrapped[1]!, expr: compiled.expr });
    for (const helper of compiled.helpers) harvest.helpers.add(helper);
    harvest.approximations.push(...compiled.approximations);
    return `{{${harvest.name()}.${key}}}`;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      replaceResidualRuby(item, harvest, Array.isArray(source) ? source[index] : undefined),
    );
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    for (const [k, v] of Object.entries(value)) {
      const key = k.includes('TODO_FORMULA')
        ? String(replaceResidualRuby(k, harvest, (src as any)[k]) ?? '')
        : k;
      out[key] = replaceResidualRuby(v, harvest, (src as any)[k]);
    }
    return out;
  }
  return value;
}

/** Step CODE que resolve as formulas de um step: devolve um campo por formula. */
function formulaCodeStep(harvest: Harvest): any {
  const inputs = [...harvest.registry.bindings.keys()].filter((name) =>
    harvest.fields.some((field) => new RegExp(`\\b${name}\\b`).test(field.expr)),
  );
  const input: Record<string, any> = {};
  for (const name of inputs) input[name] = harvest.registry.bindings.get(name);

  const ruby = harvest.fields
    .map((field) => ` *   ${field.key}: ${field.ruby.replace(/\*\//g, '* /')}`)
    .join('\n');
  const helpers = renderHelpers(harvest.helpers);
  const code = [
    '/**',
    ' * Formulas Workato traduzidas para JavaScript pelo migrador.',
    ' * Original (Ruby/Workato):',
    ruby,
    ' */',
    ...(helpers ? [helpers, ''] : []),
    'export const code = async (inputs) => {',
    ...(inputs.length ? [`  const { ${inputs.join(', ')} } = inputs;`] : []),
    '  return {',
    ...harvest.fields.map((field) => `    ${field.key}: ${field.expr},`),
    '  };',
    '};',
  ].join('\n');

  return {
    name: harvest.name(),
    skip: false,
    type: 'CODE',
    valid: true,
    settings: {
      input,
      sourceCode: { code, packageJson: '{}' },
      errorHandlingOptions: ERR(),
    },
    displayName: `Formulas Workato (${harvest.fields.length})`,
    lastUpdatedDate: NOW,
  };
}

/**
 * Converte as formulas residuais de um step em UM step CODE anterior a ele.
 * Devolve o valor com as referencias `{{formula_N.fX}}` no lugar.
 */
function resolveFormulas(value: any, ctx: Ctx, owner: string, source?: any): any {
  let assigned: string | undefined;
  const harvest: Harvest = {
    name: () => (assigned ??= nextName('formula')),
    registry: newBindingRegistry(),
    fields: [],
    helpers: new Set(),
    approximations: [],
    uncompiled: [],
  };
  const replaced = replaceResidualRuby(value, harvest, source);
  if (harvest.uncompiled.length) {
    const formulas = [...new Set(harvest.uncompiled)].join('\n\n');
    pushReviewNote(
      ctx,
      'FORMULA',
      `Passo \`${owner}\`.\n\nFormula original:\n${formulas}`,
      owner,
      owner,
    );
  }
  if (JSON.stringify(replaced).includes('janeiro') && JSON.stringify(replaced).includes('switch(get_month(now())')) {
    pushReviewNote(
      ctx,
      'FORMULA',
      `Passo \`${owner}\`.\n\nget_month devolve o mês em inglês (January). O switch troca para janeiro–dezembro. Se o iPaaS mudar o nome do mês, a troca não acha a chave.`,
      owner,
      owner,
    );
  }
  const notes = [...new Set(harvest.approximations)];
  const review = (note: string, step: string) => {
    if (
      note === MULTIPLY_NOTE ||
      note === CURRENCY_NOTE ||
      note === PHONE_NOTE ||
      note === EQ_NOTE ||
      note === DECODE_B64_NOTE
    ) {
      pushReviewNote(ctx, 'FORMULA', `Passo \`${owner}\`, step \`${step}\`.\n\n${note}`, step, step);
    }
  };
  if (!harvest.fields.length) {
    for (const note of notes) {
      ctx.todos.push(`FORMULA (${owner}): ${note}.`);
      review(note, owner);
    }
    return replaced;
  }

  ctx.pendingCode.push(formulaCodeStep(harvest));
  ctx.todos.push(
    `FORMULA (${owner}): ${harvest.fields.length} formula(s) Workato viraram JS no step ` +
      `${harvest.name()} — conferir a traducao.`,
  );
  for (const note of notes) {
    ctx.todos.push(`FORMULA (${harvest.name()}): ${note}.`);
    review(note, harvest.name());
  }
  return replaced;
}

function codeStep(
  name: string,
  displayName: string,
  input: Record<string, any>,
  code: string,
  valid = false,
  packageJson = '{}',
): any {
  return {
    name,
    skip: false,
    type: 'CODE',
    valid,
    settings: {
      input,
      sourceCode: { code, packageJson },
      errorHandlingOptions: ERR(),
    },
    displayName,
    lastUpdatedDate: NOW,
  };
}

/** Prefixos visiveis na sticky note. Skills e QA reconhecem por `id` / `content`. */
export const REVIEW_CATCH_LABEL = 'REVISAR: try/catch';
export const REVIEW_STOP_LABEL = 'REVISAR: stop_with_error';
export const REVIEW_JOB_CONTEXT_LABEL = 'REVISAR: job_context';
export const REVIEW_SECRET_LABEL = 'REVISAR: token';
export const REVIEW_FORMULA_LABEL = 'REVISAR: formula';
export const REVIEW_SUBFLOW_LABEL = 'REVISAR: subflow';
export const REVIEW_EMAIL_LABEL = 'REVISAR: email';
export const REVIEW_SMS_LABEL = 'REVISAR: sms';
export const REVIEW_SCHEDULE_LABEL = 'AVISO: agenda quinzenal';
export const REVIEW_EMPTY_UPDATE_LABEL = 'AVISO: update sem campos';
export const REVIEW_CONNECTION_LABEL = 'REVISAR: conexão';
export const REVIEW_MODAL_LABEL = 'AVISO: modal virou callback';
export const REVIEW_VARIABLES_LABEL = 'AVISO: variáveis';
export const REVIEW_REPEAT_LABEL = 'AVISO: repeat adaptado';
export const REVIEW_TEMPLATE_LABEL = 'REVISAR: message template';
export const REVIEW_TABLE_LABEL = 'REVISAR: data table';
export const REVIEW_LOOKUP_LABEL = 'AVISO: lookup table';
export const REVIEW_SOAP_LABEL = 'REVISAR: soap';
export const REVIEW_GRAPHQL_LABEL = 'REVISAR: graphql';
export const REVIEW_MAPPER_LABEL = 'AVISO: mapper sem data';
/** Frase estável da sticky note: o motor não entrega o arquivo de linhas. */
export const LOOKUP_IMPORT_NOT_GENERATED =
  'O arquivo de importação com os dados da lookup table não foi gerado.';
const PIPESIGN_GET_DOCUMENT = 'new_connector_4_connector_186728_1623952876/getDocument';

const SECRET_INPUT_KEY = /token|secret|password|api_key|apikey|authorization|bearer|access_token/i;

function secretVariableName(key: string, source: string, used: Set<string>): string {
  const host = source.match(/https?:\/\/(?:www\.)?(?:api\.)?([a-z0-9-]+)\./i);
  const provider = host?.[1]?.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
  const field = key.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'TOKEN';
  let name = provider && field === 'TOKEN' ? `${provider}_TOKEN` : provider ? `${provider}_${field}` : field;
  if (!/^[A-Za-z]/.test(name)) name = `CODE_${name}`;
  const base = name;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}

/** Literal de token no input do step CODE vira `{{variables['NOME']}}`. O valor nao entra na nota. */
function liftCodeSecrets(
  input: Record<string, any>,
  source: string,
  ctx: Ctx,
  anchorStepName: string,
): { input: Record<string, any>; source: string } {
  const used = new Set<string>();
  const found: { raw: string; name: string }[] = [];
  const walk = (value: any): any => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, any> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (
        typeof inner === 'string' &&
        SECRET_INPUT_KEY.test(key) &&
        inner.trim().length >= 8 &&
        !inner.includes('{{')
      ) {
        const name = secretVariableName(key, source, used);
        found.push({ raw: inner, name });
        if (!ctx.projectVariables.has(name)) ctx.projectVariables.set(name, 'token no código');
        out[key] = `{{variables['${name}']}}`;
      } else {
        out[key] = walk(inner);
      }
    }
    return out;
  };
  const lifted = walk(input) as Record<string, any>;
  const scrub = (value: any): any => {
    if (typeof value === 'string') {
      let next = value;
      for (const item of found) {
        if (next.includes(item.raw)) next = next.split(item.raw).join(`{{variables['${item.name}']}}`);
      }
      return next;
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [key, inner] of Object.entries(value)) out[key] = scrub(inner);
      return out;
    }
    return value;
  };
  let redacted = source;
  if (found.length) {
    for (const item of found) redacted = redacted.split(item.raw).join(`{{variables['${item.name}']}}`);
    const names = found.map((item) => item.name).join(', ');
    pushReviewNote(
      ctx,
      'SECRET',
      `Token na variavel ${names} do projeto (seguranca). Criar no iPaaS; nao fica no flow.`,
      '',
      anchorStepName,
    );
  }
  return { input: scrub(lifted), source: redacted };
}

const SLACK_PIECE = '@activepieces/piece-slack';
const SLACK_SEND_ACTIONS = new Set(['send_channel_message', 'send_direct_message']);

function emptyHits(): JobContextHits {
  return { name: 0, id: 0, link: 0, created: 0 };
}

function jobContextParagraph(hits: JobContextHits, noted: JobContextHits): string {
  const parts: string[] = [];
  if (hits.name > noted.name) {
    parts.push(
      'O nome da receita no Slack foi gravado como texto nesta migracao. Se o fluxo for renomeado no iPaaS, a mensagem continua com o nome antigo.',
    );
  }
  if (hits.id > noted.id) {
    parts.push('O recipe_id foi gravado com o id da receita na Workato, nao com o id do fluxo no iPaaS.');
  }
  if (hits.link > noted.link) {
    parts.push(
      'recipe_url e job_url viraram o checkbox Mention Origin Flow: o Slack acrescenta um link para o fluxo, nao para a execucao que falhou.',
    );
  }
  return parts.join(' ');
}

function notePendingJobContext(ctx: Ctx, anchorStepName?: string): void {
  const paragraph = jobContextParagraph(ctx.jobContextHits, ctx.jobContextNoted);
  if (!paragraph) return;
  const catchNote = [...ctx.canvasNotes].reverse().find((note) => note.kind === 'CATCH');
  if (catchNote && !catchNote.content.includes(paragraph)) {
    catchNote.content += `\n\n${paragraph}`;
  } else if (!catchNote) {
    pushReviewNote(ctx, 'JOB', paragraph, '', anchorStepName);
  }
  ctx.jobContextNoted = { ...ctx.jobContextHits };
}

function slackSendWantsFlowLink(target: MapTarget, sourceInput: Record<string, any>): boolean {
  if (target.piece !== SLACK_PIECE || !SLACK_SEND_ACTIONS.has(target.name)) return false;
  const raw = JSON.stringify(sourceInput);
  return raw.includes('job_context') && (raw.includes('recipe_url') || raw.includes('job_url'));
}

const NOTE_STEP_STRIDE = 120;
const NOTE_X = 312;

function lastStepName(head: any | undefined): string | undefined {
  let last = head;
  while (last?.nextAction) last = last.nextAction;
  return last?.name;
}

function stepDepth(root: any, name: string | undefined): number | undefined {
  if (!name) return undefined;
  const walk = (step: any, depth: number): number | undefined => {
    if (!step) return undefined;
    if (step.name === name) return depth;
    const next = walk(step.nextAction, depth + 1);
    if (next !== undefined) return next;
    if (step.firstLoopAction) {
      const inside = walk(step.firstLoopAction, depth + 1);
      if (inside !== undefined) return inside;
    }
    for (const child of step.children ?? []) {
      const branch = walk(child, depth + 1);
      if (branch !== undefined) return branch;
    }
    return undefined;
  };
  return walk(root, 0);
}

function pushReviewNote(
  ctx: Ctx,
  kind:
    | 'CATCH'
    | 'STOP'
    | 'JOB'
    | 'SECRET'
    | 'FORMULA'
    | 'SUBFLOW'
    | 'EMAIL'
    | 'SMS'
    | 'SCHEDULE'
    | 'UPDATE'
    | 'CONNECTION'
    | 'MODAL'
    | 'VARS'
    | 'REPEAT'
    | 'LOOKUP'
    | 'TABLE'
    | 'TEMPLATE'
    | 'SOAP'
    | 'GRAPHQL'
    | 'MAPPER',
  message: string,
  lost = '',
  anchorStepName?: string,
): void {
  const label =
    kind === 'MAPPER'
      ? REVIEW_MAPPER_LABEL
      : kind === 'GRAPHQL'
      ? REVIEW_GRAPHQL_LABEL
      : kind === 'SOAP'
      ? REVIEW_SOAP_LABEL
      : kind === 'LOOKUP'
      ? REVIEW_LOOKUP_LABEL
      : kind === 'TABLE'
        ? REVIEW_TABLE_LABEL
        : kind === 'REPEAT'
      ? REVIEW_REPEAT_LABEL
      : kind === 'CATCH'
      ? REVIEW_CATCH_LABEL
      : kind === 'STOP'
        ? REVIEW_STOP_LABEL
        : kind === 'SECRET'
          ? REVIEW_SECRET_LABEL
          : kind === 'FORMULA'
            ? REVIEW_FORMULA_LABEL
            : kind === 'SUBFLOW'
              ? REVIEW_SUBFLOW_LABEL
              : kind === 'EMAIL'
                ? REVIEW_EMAIL_LABEL
              : kind === 'SMS'
                ? REVIEW_SMS_LABEL
                : kind === 'SCHEDULE'
                  ? REVIEW_SCHEDULE_LABEL
                  : kind === 'UPDATE'
                    ? REVIEW_EMPTY_UPDATE_LABEL
                    : kind === 'CONNECTION'
                      ? REVIEW_CONNECTION_LABEL
                      : kind === 'MODAL'
                        ? REVIEW_MODAL_LABEL
                        : kind === 'VARS'
                          ? REVIEW_VARIABLES_LABEL
                          : kind === 'TEMPLATE'
                            ? REVIEW_TEMPLATE_LABEL
                            : REVIEW_JOB_CONTEXT_LABEL;
  const prefix =
    kind === 'MAPPER'
      ? 'review_mapper'
      : kind === 'GRAPHQL'
      ? 'review_graphql'
      : kind === 'SOAP'
      ? 'review_soap'
      : kind === 'LOOKUP'
      ? 'review_lookup'
      : kind === 'TABLE'
        ? 'review_table'
        : kind === 'REPEAT'
      ? 'review_repeat'
      : kind === 'CATCH'
      ? 'review_catch'
      : kind === 'STOP'
        ? 'review_stop'
        : kind === 'SECRET'
          ? 'review_secret'
          : kind === 'FORMULA'
            ? 'review_formula'
            : kind === 'SUBFLOW'
              ? 'review_subflow'
              : kind === 'EMAIL'
                ? 'review_email'
                : kind === 'SMS'
                  ? 'review_sms'
                  : kind === 'SCHEDULE'
                    ? 'review_schedule'
                    : kind === 'UPDATE'
                      ? 'review_update'
                      : kind === 'CONNECTION'
                        ? 'review_connection'
                        : kind === 'MODAL'
                          ? 'review_modal'
                          : kind === 'VARS'
                            ? 'review_variables'
                            : kind === 'TEMPLATE'
                              ? 'review_template'
                              : 'review_job';
  const suffix = lost ? ` — ${lost}` : '';
  const title = `${label}${suffix}`.slice(0, 120);
  ctx.canvasNotes.push({
    id: nextName(prefix),
    kind,
    content: `**${title}**\n\n${message}`,
    anchorStepName,
  });
}

/** Uma nota por `table_id`. A piece Tables continua mapeada; a nota avisa que as linhas não vieram. */
function noteWorkatoDataTable(ctx: Ctx, step: ParsedStep, anchorStepName: string): void {
  const opKey = collapseOpKey(step.opKey ?? `${step.provider ?? ''}/${step.name ?? ''}`);
  if (!opKey.startsWith('workato_db_table/')) return;
  const raw = step.input?.table_id;
  const tableId = raw == null ? '' : String(raw).trim();
  if (!tableId || ctx.notedDataTableIds.has(tableId)) return;
  ctx.notedDataTableIds.add(tableId);
  pushReviewNote(
    ctx,
    'TABLE',
    [
      `Data table Workato \`${tableId}\`.`,
      'A Table do iPaaS não herda esse id e não inclui as linhas originais.',
      'O migrador não gerou um arquivo com as linhas dessa data table para importação. Exporte essa data table na Workato.',
    ].join('\n\n'),
    '',
    anchorStepName,
  );
}

function noteProjectVariables(ctx: Ctx, anchorStepName?: string): void {
  if (!ctx.projectVariables.size) return;
  const lines = [...ctx.projectVariables.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, origin]) => `- \`${name}\` — ${origin}`);
  pushReviewNote(
    ctx,
    'VARS',
    `A receita usa variáveis do projeto. Criar no iPaaS:\n\n${lines.join('\n')}`,
    '',
    anchorStepName,
  );
}

function placeCanvasNotes(trigger: any, pending: PendingCanvasNote[]): any[] {
  return pending.map((note, index) => {
    const depth =
      stepDepth(trigger, note.anchorStepName) ??
      stepDepth(trigger, lastStepName(trigger)) ??
      index + 1;
    return {
      id: note.id,
      content: note.content,
      ownerId: null,
      color: 'yellow',
      position: { x: NOTE_X, y: depth * NOTE_STEP_STRIDE + index * 220 },
      size: {
        width: note.kind === 'FORMULA' ? 360 : 280,
        height:
          note.kind === 'STOP'
            ? 200
            : note.kind === 'FORMULA'
              ? Math.min(640, Math.max(280, 120 + Math.ceil(note.content.length / 2)))
              : note.content.length > 280
                ? 360
                : 240,
      },
      createdAt: NOW,
      updatedAt: NOW,
    };
  });
}

function todoPieceStep(name: string, displayName: string, input: Record<string, any>): any {
  return {
    name,
    skip: false,
    type: 'PIECE',
    valid: false,
    settings: {
      input,
      pieceName: TODO_PIECE,
      actionName: TODO_PIECE,
      pieceVersion: '~latest',
      propertySettings: {},
      errorHandlingOptions: ERR(),
    },
    displayName,
    lastUpdatedDate: NOW,
  };
}

function storeActionStep(
  name: string,
  actionName: string,
  input: Record<string, any>,
  displayName: string,
  valid: boolean,
  skip: boolean,
  ctx: Ctx,
): any {
  ctx.piecesUsed.add(STORE_PIECE);
  return {
    name,
    skip,
    type: 'PIECE',
    valid,
    settings: {
      input,
      pieceName: STORE_PIECE,
      actionName,
      pieceVersion: pieceVersion(ctx, STORE_PIECE),
      propertySettings: propertySettings(input),
      errorHandlingOptions: ERR(),
    },
    displayName,
    lastUpdatedDate: NOW,
  };
}

function resolvedWrite(
  step: ParsedStep,
  op: NonNullable<ReturnType<typeof variableOp>>,
  decl: VarDecl,
  ctx: Ctx,
  name: string,
): { fields: Record<string, any>; valid: boolean } {
  const fields = resolveFormulas(convInput(writtenFields(step, op), undefined, ctx), ctx, name);
  const ruby: string[] = [];
  collectResidualRubyMethods(fields, '', ruby);
  if (ruby.length) {
    ctx.todos.push(
      `FORMULA (${name}): a escrita de "${decl.label}" carrega formula Workato sem equivalente ` +
        `em template AP: ${ruby.join(', ')}. Traduzir para JS dentro do step.`,
    );
  }
  return { fields, valid: !ruby.length && !hasTodoMarker(fields) };
}

/** Declare escalar sem valor: o passo nao vira Storage nem stub CODE. */
const OMIT_STEP = Symbol('omit-variable-step');

/**
 * Variavel Workato vira piece-store, escopo RUN.
 *
 * Escalar: um `put` por campo com valor. Chave = nome do campo, valor = escalar.
 * Declare vazio nao emite `put`. Update grava so o campo novo, sem juntar o objeto.
 *
 * Lista: `put` de `[]` no declare vazio e no clear. Insert e `add_to_list`
 * com um array de strings JSON. Lote com `current_item` calcula as strings
 * num Code e o Storage grava o array.
 */
function buildVariableStep(step: ParsedStep, ctx: Ctx): any | null | typeof OMIT_STEP {
  const op = variableOp(step);
  const decl = writtenVariable(step, ctx);
  // Escrita sem declare correspondente na receita: sem saber a forma do valor,
  // o caminho antigo (stub CODE + TODO) continua sendo a resposta honesta.
  if (!op || !decl) return null;

  const name = stepName(step, ctx);
  const skip = step.skip === true;
  const display =
    step.comment ||
    (decl.kind === 'list' ? `Gravar lista "${decl.label}"` : `Gravar variavel "${decl.label}"`);

  if (decl.kind === 'scalar') return buildScalarStore(step, op, decl, ctx, name, display, skip);
  return buildListStore(step, op, decl, ctx, name, display, skip);
}

function buildScalarStore(
  step: ParsedStep,
  op: NonNullable<ReturnType<typeof variableOp>>,
  decl: VarDecl,
  ctx: Ctx,
  name: string,
  display: string,
  skip: boolean,
): any {
  const { fields, valid } = resolvedWrite(step, op, decl, ctx, name);
  const entries = Object.entries(fields).filter(([, value]) => value != null);
  if (!entries.length) return OMIT_STEP;

  let head: any;
  for (const [index, [field, value]] of entries.entries()) {
    const put = storeActionStep(
      index === 0 ? name : nextName('var_put'),
      'put',
      { key: scalarStorageKey(field), value, store_scope: STORE_SCOPE },
      entries.length === 1 ? display : `Gravar variavel "${field}"`,
      valid,
      skip,
      ctx,
    );
    head = appendToChain(head, put);
  }
  return head;
}

function buildListStore(
  step: ParsedStep,
  op: NonNullable<ReturnType<typeof variableOp>>,
  decl: VarDecl,
  ctx: Ctx,
  name: string,
  display: string,
  skip: boolean,
): any {
  if (String(step.input?.location ?? 'end') === 'start') {
    ctx.todos.push(
      `LISTA (${name}): insert no inicio da lista "${decl.label}". O Storage add_to_list so acrescenta no fim.`,
    );
  }

  const batch = op === 'insert_batch' || op === 'declare' ? listBatchFields(step) : [];
  const hasSource = Boolean(step.input?.list_items?.[SOURCE_KEY]);
  if (hasSource && batch.length >= 0 && (op === 'insert_batch' || op === 'declare')) {
    return buildListBatch(step, op, decl, ctx, name, display, skip, batch);
  }

  if (op === 'clear' || op === 'declare') {
    const { fields, valid } = resolvedWrite(step, op, decl, ctx, name);
    if (op === 'clear' || !Object.keys(fields).length) {
      return storeActionStep(
        name,
        'put',
        { key: decl.storeKey, value: '[]', store_scope: STORE_SCOPE },
        display,
        valid,
        skip,
        ctx,
      );
    }
    return storeActionStep(
      name,
      'add_to_list',
      {
        key: decl.storeKey,
        value: [listItemJson(fields)],
        ignore_if_exists: false,
        store_scope: STORE_SCOPE,
      },
      display,
      valid,
      skip,
      ctx,
    );
  }

  const { fields, valid } = resolvedWrite(step, op, decl, ctx, name);
  return storeActionStep(
    name,
    'add_to_list',
    {
      key: decl.storeKey,
      value: [listItemJson(fields)],
      ignore_if_exists: false,
      store_scope: STORE_SCOPE,
    },
    display,
    valid,
    skip,
    ctx,
  );
}

function buildListBatch(
  step: ParsedStep,
  op: NonNullable<ReturnType<typeof variableOp>>,
  decl: VarDecl,
  ctx: Ctx,
  name: string,
  display: string,
  skip: boolean,
  batch: ReturnType<typeof listBatchFields>,
): any {
  const codeName = nextName('var_items');
  const input: Record<string, any> = {};
  const fields = convInput(writtenFields(step, op), undefined, ctx);
  if (Object.keys(fields).length) input[FIELDS_KEY] = fields;
  input[SOURCE_INPUT_KEY] = deepConvert(step.input?.list_items?.[SOURCE_KEY], ctx);
  const resolved = resolveFormulas(input, ctx, codeName);
  const ruby: string[] = [];
  collectResidualRubyMethods(resolved, '', ruby);
  if (ruby.length) {
    ctx.todos.push(
      `FORMULA (${name}): a escrita de "${decl.label}" carrega formula Workato sem equivalente ` +
        `em template AP: ${ruby.join(', ')}. Traduzir para JS dentro do step.`,
    );
  }
  const valid = !ruby.length && !hasTodoMarker(resolved);
  const code = codeStep(codeName, `Itens JSON "${decl.label}"`, resolved, listBatchCode(batch), valid);
  code.skip = skip;
  code.nextAction = storeActionStep(
    name,
    'add_to_list',
    {
      key: decl.storeKey,
      value: `{{${codeName}}}`,
      ignore_if_exists: false,
      store_scope: STORE_SCOPE,
    },
    display,
    valid,
    skip,
    ctx,
  );
  return code;
}

const HTTP_PIECE = '@activepieces/piece-http';
const HTTP_SEND_TARGET: MapTarget = { piece: HTTP_PIECE, name: 'send_request', kind: 'action' };
const AUTENTIQUE_GRAPHQL_URL = 'https://api.autentique.com.br/v2/graphql';

/** PipeSign getDocument: POST GraphQL na Autentique. extractText exige file e so recebe id. */
function buildPipesignGetDocument(
  name: string,
  display: string,
  sourceInput: Record<string, any>,
  ctx: Ctx,
): any {
  ctx.piecesUsed.add(HTTP_PIECE);
  const id = convertedField(sourceInput.id, ctx, name, '');
  const input: Record<string, any> = {
    method: 'POST',
    url: AUTENTIQUE_GRAPHQL_URL,
    headers: {},
    queryParams: {},
    authType: 'none',
    body_type: 'json',
    body: { query: `{ document(id: "${id}") { id name files { original signed } } }` },
  };
  envelopeDynamicProps(input, ctx, HTTP_SEND_TARGET);
  return {
    name,
    skip: false,
    type: 'PIECE',
    valid: missingRequiredProps(ctx, HTTP_SEND_TARGET, input).length === 0 && !hasTodoMarker(input),
    settings: {
      input,
      pieceName: HTTP_PIECE,
      actionName: 'send_request',
      pieceVersion: pieceVersion(ctx, HTTP_PIECE),
      propertySettings: settingsFor(HTTP_PIECE, 'send_request', input),
      errorHandlingOptions: ERR(),
    },
    displayName: display,
    lastUpdatedDate: NOW,
  };
}

function httpUrlString(url: unknown): string {
  if (url && typeof url === 'object' && 'url' in url) return String((url as { url?: unknown }).url ?? '').trim();
  return String(url ?? '').trim();
}

/**
 * Conector Omie sem `request.url`: o input da receita e o `param` do POST.
 * So preenche quando o mapa ja mandou para HTTP e a URL ficou vazia.
 */
function fillOmieHttp(
  opKey: string,
  target: MapTarget,
  input: Record<string, any>,
  sourceInput: Record<string, any>,
  ctx: Ctx,
  name: string,
): Record<string, any> | null {
  if (target.piece !== HTTP_PIECE || target.name !== 'send_request') return null;
  const action = omieActionName(collapseOpKey(opKey));
  if (!action || httpUrlString(input.url)) return null;
  const param = resolveFormulas(deepConvert(sourceInput, ctx), ctx, name);
  const filled = omieHttpInput(action, param);
  if (!filled) {
    ctx.todos.push(`OMIE (${name}): "${action}" sem endpoint na API publica — URL continua vazia.`);
    return null;
  }
  envelopeDynamicProps(filled, ctx, target);
  ctx.projectVariables.set(OMIE_APP_KEY, 'credencial Omie');
  ctx.projectVariables.set(OMIE_APP_SECRET, 'credencial Omie');
  if (!ctx.canvasNotes.some((note) => note.content.includes(OMIE_APP_KEY))) {
    pushReviewNote(
      ctx,
      'SECRET',
      `Credencial Omie nas variaveis ${OMIE_APP_KEY} e ${OMIE_APP_SECRET} do projeto (seguranca). Criar no iPaaS; nao fica no flow.`,
      '',
      name,
    );
  }
  return filled;
}

function convertedField(value: unknown, ctx: Ctx, owner: string, fallback: string): any {
  if (typeof value !== 'string') return value == null || value === '' ? fallback : value;
  const converted = resolveFormulas(pills(value, ctx), ctx, owner, value);
  return converted === '' ? fallback : converted;
}

/** parse_csv não usa piece-csv: o Code devolve { lines } com as colunas da receita. */
function buildParseCsv(
  name: string,
  display: string,
  sourceInput: Record<string, any>,
  ctx: Ctx,
): any {
  const plan = csvParsePlan(sourceInput);
  const input = {
    csv: convertedField(sourceInput.csv_content, ctx, name, ''),
    separator: convertedField(sourceInput.col_sep, ctx, name, plan.separator),
    quote: convertedField(sourceInput.quote_char, ctx, name, plan.quote),
    skipFirstLine: plan.skipFirstLine,
  };
  return codeStep(name, display, input, csvParseCode(plan.columns), true);
}

/** Message template do Workato: o corpo fica na conta, fora da receita. */
function templateInputFields(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, any> = {};
  for (const [key, item] of Object.entries(value as Record<string, any>)) {
    if (item === '=skip' || key === '') continue;
    out[key] = item;
  }
  return out;
}

function messageTemplateCode(keys: string[]): string {
  const lines = keys.map((key) => `    ${JSON.stringify(key)}: inputs[${JSON.stringify(key)}],`);
  return ['export const code = async (inputs) => {', '  return {', ...lines, '  };', '};'].join('\n');
}

function messageTemplateNote(templateId: unknown): string {
  const id = templateId == null || String(templateId).trim() === ''
    ? 'O id do message template não veio na receita.'
    : `Message template do Workato, id ${String(templateId).trim()}.`;
  return [
    id,
    'O corpo do template não está na receita, então o texto não foi montado. Copie o template no Workato.',
  ].join('\n\n');
}

function buildMessageTemplate(
  name: string,
  display: string,
  sourceInput: Record<string, any>,
  ctx: Ctx,
): any {
  const fields = templateInputFields(sourceInput.template_input);
  const input = resolveFormulas(convInput(fields, undefined, ctx), ctx, name, fields);
  pushReviewNote(ctx, 'TEMPLATE', messageTemplateNote(sourceInput.template_id), '', name);
  return codeStep(name, display, input, messageTemplateCode(Object.keys(input)), !hasTodoMarker(input));
}

/** SOAP tools by Workato monta o XML a partir do template. O corpo não vem na receita. */
function soapCreateMessageNote(templateId: unknown): string {
  const id = templateId == null || String(templateId).trim() === ''
    ? 'O id do template SOAP não veio na receita.'
    : `Template SOAP do Workato, id ${String(templateId).trim()}.`;
  return [
    id,
    'O corpo do template SOAP não veio na receita, então o XML do request não foi montado. Copie o template no Workato.',
  ].join('\n\n');
}

function buildSoapCreateMessage(
  name: string,
  display: string,
  sourceInput: Record<string, any>,
  ctx: Ctx,
): any {
  const fields = templateInputFields(sourceInput.template_input);
  const input = resolveFormulas(convInput(fields, undefined, ctx), ctx, name, fields);
  pushReviewNote(ctx, 'SOAP', soapCreateMessageNote(sourceInput.template_id), '', name);
  return codeStep(name, display, input, messageTemplateCode(Object.keys(input)), !hasTodoMarker(input));
}

function includeDoneIsFalse(input: Record<string, any>): boolean {
  const raw = input.include_done ?? input.includeDone;
  return raw === false || raw === 0 || /^(false|no|0)$/i.test(String(raw ?? '').trim());
}

function buildLogger(name: string, display: string, sourceInput: Record<string, any>, ctx: Ctx): any {
  const message = resolveFormulas(pills(String(sourceInput.message ?? ''), ctx), ctx, name, sourceInput.message);
  const code = [
    'export const code = async (inputs) => {',
    '  return { message: inputs.message };',
    '};',
  ].join('\n');
  return codeStep(name, display, { message }, code, !hasTodoMarker({ message }));
}

const CREATE_LIST_CODE = 'export const code = async (inputs) => { return { items: [] }; };';

/** Payload de itens no input. `size` sozinho nao e item — a lista sai vazia. */
function createListPayload(source: Record<string, any>): unknown | undefined {
  const keys = Object.keys(source).filter((key) => {
    if (key === 'size') return false;
    const value = source[key];
    return value != null && value !== '' && value !== '=skip';
  });
  if (!keys.length) return undefined;
  if (keys.length === 1) return source[keys[0]!];
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function accumulateItem(raw: unknown): unknown {
  let value = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        return raw;
      }
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
    return (value as Record<string, unknown>).data;
  }
  return value;
}

/**
 * Lists by Workato `create_list` vira Code com array em `items`.
 * Storage `[]` quebra o Loop on items. `size` sozinho (forma real das receitas) devolve `[]`.
 */
function buildCreateList(name: string, display: string, step: ParsedStep, ctx: Ctx): any {
  const payload = createListPayload(step.input ?? {});
  if (payload === undefined) return codeStep(name, display, {}, CREATE_LIST_CODE, true);
  const items = resolveFormulas(deepConvert(payload, ctx), ctx, name);
  const code = [
    'export const code = async (inputs) => {',
    '  const raw = inputs.items;',
    '  const items = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];',
    '  return { items };',
    '};',
  ].join('\n');
  return codeStep(name, display, { items }, code, !hasTodoMarker({ items }));
}

/**
 * `accumulate_list_items` que alimenta um foreach: o loop le o array deste Code.
 * Acumulo que ninguem percorre continua no caminho generico.
 */
function buildAccumulateList(name: string, display: string, step: ParsedStep, ctx: Ctx): any {
  const item = resolveFormulas(deepConvert(accumulateItem(step.input?.list_item), ctx), ctx, name);
  const code = [
    'export const code = async (inputs) => {',
    '  if (Array.isArray(inputs.item)) return { items: inputs.item };',
    '  if (inputs.item == null || inputs.item === "") return { items: [] };',
    '  return { items: [inputs.item] };',
    '};',
  ].join('\n');
  return codeStep(name, display, { item }, code, !hasTodoMarker({ item }));
}

/** Python que só importa `time` e dorme um literal. Outro corpo fica no stub. */
function pythonSleepMs(python: string): number | null {
  const lines = python
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length !== 3) return null;
  if (lines[0] !== 'import time') return null;
  if (!/^def\s+main\s*\(\s*[A-Za-z_]\w*\s*\)\s*:$/.test(lines[1]!)) return null;
  const sleep = lines[2]!.match(/^time\.sleep\(\s*(\d+(?:\.\d+)?)\s*\)$/);
  if (!sleep) return null;
  const ms = Math.round(Number(sleep[1]) * 1000);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Ruby do CAPEX que só avança N dias úteis (pula sáb/dom) e devolve
 * `data_resultado` como `YYYY-MM-DDT18:00:00`. Outro corpo fica no stub.
 */
function isBusinessDaysRuby(ruby: string): boolean {
  const compact = ruby
    .replace(/#.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    compact ===
    `data = Time.parse(input['data_base'].to_s) dias_uteis = (input['dias_uteis'] || 5).to_i while dias_uteis > 0 data = data + 1.day if data.wday != 0 && data.wday != 6 dias_uteis = dias_uteis - 1 end end { data_resultado: data.strftime("%Y-%m-%d") + "T18:00:00" }`
  );
}

function businessDaysCode(): string {
  return [
    'export const code = async (inputs) => {',
    '  const match = String(inputs.data_base == null ? "" : inputs.data_base).match(/(\\d{4})-(\\d{2})-(\\d{2})/);',
    '  if (!match) throw new Error("data_base");',
    '  const cursor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));',
    '  let remaining = Number.parseInt(String(inputs.dias_uteis == null ? 5 : inputs.dias_uteis), 10);',
    '  if (!Number.isFinite(remaining)) remaining = 5;',
    '  while (remaining > 0) {',
    '    cursor.setUTCDate(cursor.getUTCDate() + 1);',
    '    const wday = cursor.getUTCDay();',
    '    if (wday !== 0 && wday !== 6) remaining -= 1;',
    '  }',
    '  const y = cursor.getUTCFullYear();',
    '  const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");',
    '  const d = String(cursor.getUTCDate()).padStart(2, "0");',
    '  return { data_resultado: `${y}-${m}-${d}T18:00:00` };',
    '};',
  ].join('\n');
}

/**
 * Python que só importa `random`, sorteia `randint(100000000, 999999999)`
 * e devolve `random_number`. Comentário de amostra do Workato não conta.
 * Outro corpo fica no stub.
 */
function pythonRandomNineDigits(python: string): boolean {
  const lines = python
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length !== 4) return false;
  if (lines[0] !== 'import random') return false;
  if (!/^def\s+main\s*\(\s*[A-Za-z_]\w*\s*\)\s*:$/.test(lines[1]!)) return false;
  if (!/^random_number\s*=\s*random\.randint\(\s*100000000\s*,\s*999999999\s*\)$/.test(lines[2]!)) return false;
  return /^return\s+\{\s*['"]random_number['"]\s*:\s*random_number\s*\}$/.test(lines[3]!);
}

function pythonRandomNineDigitsCode(): string {
  return [
    '// py_eval/invoke_custom_py_code',
    'export const code = async () => {',
    '  const random_number = Math.floor(Math.random() * 900000000) + 100000000;',
    '  return { random_number };',
    '};',
  ].join('\n');
}

function buildPythonSleep(name: string, display: string, step: ParsedStep, ctx: Ctx, ms: number): any {
  const raw = (step.input?.code_input?.data ?? {}) as Record<string, any>;
  const input = resolveFormulas(convInput(raw, undefined, ctx), ctx, name);
  const code = [
    '// py_eval/invoke_custom_py_code',
    'export const code = async (inputs) => {',
    `  await new Promise((resolve) => setTimeout(resolve, ${ms}));`,
    '  return inputs;',
    '};',
  ].join('\n');
  return codeStep(name, display, input, code, !hasTodoMarker(input));
}

function isNodeIdsPython(python: string): boolean {
  const compact = python.replace(/\s+/g, ' ');
  return (
    /nodes\s*=\s*input\[\s*["']nodes["']\s*\]/.test(compact) &&
    /\[\s*int\(\s*node\[\s*["']id["']\s*\]\s*\)\s+for\s+node\s+in\s+nodes\s*\]/.test(compact) &&
    /return\s*\{\s*["']ids["']\s*:\s*ids\s*\}/.test(compact)
  );
}

function buildNodeIdsPython(name: string, display: string, step: ParsedStep, ctx: Ctx): any {
  const raw = (step.input?.code_input?.data ?? {}) as Record<string, any>;
  const input = resolveFormulas(convInput(raw, undefined, ctx), ctx, name);
  const code = [
    '// py_eval/invoke_custom_py_code',
    'export const code = async (inputs) => {',
    '  const nodes = Array.isArray(inputs.nodes) ? inputs.nodes : [];',
    '  return { ids: nodes.map((node) => Number(node && node.id)) };',
    '};',
  ].join('\n');
  return codeStep(name, display, input, code, !hasTodoMarker(input));
}

function buildXlsxPython(name: string, display: string, step: ParsedStep, ctx: Ctx): any {
  const raw = (step.input?.code_input?.data ?? {}) as Record<string, any>;
  const input = resolveFormulas(convInput(raw, undefined, ctx), ctx, name);
  const sheet = xlsxSheetName(String(step.input?.code ?? ''));
  return codeStep(name, display, input, xlsxToCsvPureCode(sheet), !hasTodoMarker(input));
}

function buildOpenCardsSearch(name: string, display: string, sourceInput: Record<string, any>, ctx: Ctx): any {
  const input = {
    pipeId: convertedField(sourceInput.pipe_id, ctx, name, ''),
    fieldId: convertedField(sourceInput.field_id, ctx, name, ''),
    fieldValue: convertedField(sourceInput.field_value, ctx, name, ''),
  };
  const code = [
    'export const code = async (inputs) => {',
    '  const query = `query ($pipeId: ID!, $after: String) {',
    '    cards(pipe_id: $pipeId, first: 50, after: $after, search: { include_done: false }) {',
    '      pageInfo { hasNextPage endCursor }',
    '      edges { node { id title done finished_at fields { name value field { id } } } }',
    '    }',
    '  }`;',
    '  const cards = [];',
    '  let after = null;',
    '  for (let page = 0; page < 20; page++) {',
    '    const response = await fetch("https://api.pipefy.com/graphql", {',
    '      method: "POST",',
    '      headers: { "Content-Type": "application/json", Authorization: inputs.authorization || "" },',
    '      body: JSON.stringify({ query, variables: { pipeId: inputs.pipeId, after } }),',
    '    });',
    '    const payload = await response.json();',
    '    const block = payload && payload.data && payload.data.cards;',
    '    for (const edge of (block && block.edges) || []) {',
    '      if (edge && edge.node) cards.push(edge.node);',
    '    }',
    '    if (!block || !block.pageInfo || !block.pageInfo.hasNextPage) break;',
    '    after = block.pageInfo.endCursor;',
    '  }',
    '  const fieldId = String(inputs.fieldId == null ? "" : inputs.fieldId);',
    '  const fieldValue = String(inputs.fieldValue == null ? "" : inputs.fieldValue);',
    '  const open = cards.filter((card) => {',
    '    if (!card || card.done === true || card.finished_at) return false;',
    '    return (card.fields || []).some((field) => {',
    '      const id = field && field.field ? field.field.id : "";',
    '      const name = field && field.name ? field.name : "";',
    '      return (id === fieldId || name === fieldId) && String(field.value == null ? "" : field.value) === fieldValue;',
    '    });',
    '  });',
    '  return { cards: open };',
    '};',
  ].join('\n');
  return codeStep(name, display, { ...input, authorization: '' }, code, !hasTodoMarker(input));
}

function workatoHeaders(raw: unknown, ctx: Ctx): Record<string, any> {
  if (!Array.isArray(raw)) return {};
  const headers: Record<string, any> = {};
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const key = String((item as any).header ?? (item as any).name ?? '').trim();
    if (!key) continue;
    headers[key] = deepConvert((item as any).value, ctx);
  }
  return headers;
}

const GOOGLE_SHEETS_PIECE = '@activepieces/piece-google-sheets';

/** Workato `columns` usa `col_<cabeçalho>`. A piece lê o nome do cabeçalho. */
function sheetHeaderValues(value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, any> = {};
  for (const [key, item] of Object.entries(value as Record<string, any>)) {
    if (item === '=skip') continue;
    const name = key.startsWith('col_') ? key.slice(4) : key;
    if (!name) continue;
    out[name] = item;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Workato `is_top_left` + `col_N` sem `column_headers` = colunas posicionais. */
function sheetsTopLeftCols(sourceInput: Record<string, any>): boolean {
  if (asEnableFlag(sourceInput.is_top_left) !== true) return false;
  const headers = sourceInput.column_headers;
  if (headers != null && headers !== '' && headers !== '=skip') return false;
  const data = sourceInput.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Object.keys(data).some((key) => /^col_\d+$/i.test(key));
}

function blankProp(value: unknown): boolean {
  return value == null || value === '';
}

function phaseFieldsBlank(value: unknown): boolean {
  if (blankProp(value)) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function copyProp(input: Record<string, any>, dest: string, ...sources: string[]): void {
  if (!blankProp(input[dest])) return;
  for (const source of sources) {
    if (!blankProp(input[source]) && input[source] !== '=skip') {
      input[dest] = input[source];
      return;
    }
  }
}

/** Renomeia props Workato para o nome obrigatório da piece quando o valor já está no input. */
function fillKnownProps(
  target: MapTarget,
  input: Record<string, any>,
  sourceInput: Record<string, any>,
): Record<string, any> {
  if (target.piece === '@activepieces/piece-microsoft-outlook' && target.name === 'send-email') {
    copyProp(input, 'subject', 'Subject');
    copyProp(input, 'body', 'Content');
    if (blankProp(input.recipients) && !blankProp(input.ToRecipients)) {
      const to = input.ToRecipients;
      input.recipients = Array.isArray(to) ? to : [to];
    }
    if (blankProp(input.bodyFormat) && !blankProp(input.ContentType)) {
      const kind = String(input.ContentType).toLowerCase();
      input.bodyFormat = kind.includes('html') ? 'html' : 'text';
    }
  }

  if (target.piece === GOOGLE_SHEETS_PIECE) {
    copyProp(input, 'spreadsheetId', 'spreadsheet', 'spreadsheet_id');
    copyProp(input, 'sheetId', 'sheet', 'sheet_name');
    if (blankProp(input.spreadsheetId) && !blankProp(sourceInput.spreadsheet_id)) input.spreadsheetId = sourceInput.spreadsheet_id;
    if (blankProp(input.sheetId) && !blankProp(sourceInput.sheet_name)) input.sheetId = sourceInput.sheet_name;
    copyProp(input, 'values', 'data', 'rows');
    if (blankProp(input.values)) {
      const columns = sheetHeaderValues(input.columns ?? sourceInput.columns);
      if (columns) input.values = columns;
    }
    if (
      (target.name === 'insert_row' || target.name === 'update_row' || target.name === 'get-many-rows') &&
      blankProp(input.first_row_headers)
    ) {
      input.first_row_headers = !(target.name === 'insert_row' && sheetsTopLeftCols(sourceInput));
    }
  }

  if (target.piece === '@activepieces/piece-date-helper' && target.name === 'get_current_date') {
    if (blankProp(input.timeZone)) input.timeZone = 'America/Sao_Paulo';
    if (blankProp(input.timeFormat)) input.timeFormat = 'yyyy-MM-dd HH:mm:ss';
  }

  if (target.piece === '@activepieces/piece-google-calendar' && target.name === 'create_google_calendar_event') {
    copyProp(input, 'calendar_id', 'id');
    copyProp(input, 'title', 'summary');
    copyProp(input, 'start_date_time', 'start');
    copyProp(input, 'send_notifications', 'sendNotifications');
  }
  if (target.piece === '@activepieces/piece-google-calendar' && target.name === 'new_or_updated_event') {
    copyProp(input, 'calendar_id', 'id');
    if (blankProp(input.expandRecurringEvent)) input.expandRecurringEvent = false;
  }

  if (target.piece === '@activepieces/piece-google-drive' && target.name === 'update_permissions') {
    if (blankProp(input.send_invitation_email)) input.send_invitation_email = false;
  }

  if (target.piece === '@activepieces/piece-google-drive' && target.name === 'upload_gdrive_file') {
    copyProp(input, 'fileName', 'name');
    copyProp(input, 'file', 'fileContent');
    if (blankProp(input.parentFolder) && !blankProp(input.parents)) {
      const parents = input.parents;
      if (Array.isArray(parents) && parents.length === 1) input.parentFolder = parents[0];
      else if (!Array.isArray(parents)) input.parentFolder = parents;
    }
  }

  if (target.piece === '@activepieces/piece-google-docs' && target.name === 'append_text') {
    copyProp(input, 'documentId', 'document_id');
    if (blankProp(input.text) && blankProp(input.requests) && !blankProp(sourceInput.requests)) {
      input.requests = sourceInput.requests;
    }
  }

  if (target.piece === '@activepieces/piece-microsoft-outlook-calendar' && target.name === 'create_event') {
    if (blankProp(input.timezone)) {
      const zone = sourceInput.StartTimeZone ?? sourceInput.startTimeZone ?? input.StartTimeZone;
      if (!blankProp(zone)) input.timezone = zone;
    }
  }

  if (target.piece === PIPEFY_PIECE && target.name === 'cardExpired') {
    copyProp(input, 'organizationId', 'organization_id');
    copyProp(input, 'pipeId', 'pipe_id');
    if (blankProp(input.phaseId) && !blankProp(input.on_phase_ids)) {
      const phases = input.on_phase_ids;
      if (Array.isArray(phases) && phases.length === 1) input.phaseId = phases[0];
      else if (typeof phases === 'string' && !phases.includes(',')) input.phaseId = phases;
    }
  }

  if (target.piece === PIPEFY_PIECE && target.name === 'updateCard') {
    copyProp(input, 'cardId', 'node_ID', 'Node_Id', 'card_id');
    copyProp(input, 'phaseFields', 'Fields_to_update');
    copyProp(input, 'organizationId', 'organization_id');
    copyProp(input, 'pipeId', 'pipe_id');
    copyProp(input, 'phaseId', 'phase_id');
    if (phaseFieldsBlank(input.phaseFields)) {
      const fieldId = input.field_id ?? sourceInput.field_id;
      const value = input.new_value !== undefined ? input.new_value : sourceInput.new_value;
      if (!blankProp(fieldId) && value !== undefined && value !== '') {
        input.phaseFields = { [String(fieldId)]: value };
        delete input.field_id;
        delete input.new_value;
      }
    } else if (input.phaseFields && typeof input.phaseFields === 'object' && !Array.isArray(input.phaseFields)) {
      const packed = input.phaseFields as Record<string, any>;
      const keys = Object.keys(packed);
      if (!blankProp(packed.field_id) && packed.new_value !== undefined && keys.every((key) => key === 'field_id' || key === 'new_value')) {
        input.phaseFields = { [String(packed.field_id)]: packed.new_value };
      }
    }
    // Workato manda [{fieldId, value}] em Fields_to_update. A piece espera { slug: valor }.
    if (Array.isArray(input.phaseFields)) {
      const fields: Record<string, any> = {};
      for (const item of input.phaseFields) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const id = item.fieldId ?? item.field_id;
        if (id == null || id === '') continue;
        fields[String(id)] = item.value;
      }
      if (Object.keys(fields).length) input.phaseFields = fields;
    }
  }

  if (target.piece === PIPEFY_PIECE && target.name === 'getRecordsByFilter') {
    // organization_id e table_id no proprio passo viram as props da piece.
    // Organizacao so no gatilho, e qual string vai em `order`, ficam em aberto.
    copyProp(input, 'organizationId', 'organization_id');
    if (!blankProp(input.organizationId)) delete input.organization_id;
    copyProp(input, 'databaseId', 'table_id');
    if (!blankProp(input.databaseId)) delete input.table_id;
    if (blankProp(input.includeDone) && !blankProp(input.include_done)) {
      const flag = asEnableFlag(input.include_done);
      if (typeof flag === 'boolean') {
        input.includeDone = flag;
        delete input.include_done;
      }
    }
  }

  return input;
}

/** `update_document` manda `requests` de batchUpdate, não um texto para append. */
function googleDocsBatchUpdate(target: MapTarget, input: Record<string, any>): Record<string, any> | null {
  if (target.piece !== '@activepieces/piece-google-docs' || target.name !== 'append_text') return null;
  if (!blankProp(input.text) || blankProp(input.requests) || blankProp(input.documentId)) return null;
  return {
    method: 'POST',
    url: `https://docs.googleapis.com/v1/documents/${input.documentId}:batchUpdate`,
    headers: {},
    queryParams: {},
    body_type: 'json',
    body: { requests: input.requests },
  };
}

function fillSheetsInsertRow(
  target: MapTarget,
  input: Record<string, any>,
  sourceInput: Record<string, any>,
): Record<string, any> {
  if (target.piece !== GOOGLE_SHEETS_PIECE || target.name !== 'insert_row') return input;
  if (input.first_row_headers !== undefined) return input;
  if (sheetsTopLeftCols(sourceInput)) input.first_row_headers = false;
  return input;
}

const JOB_NOW_CODE = `export const code = async () => {
  return { now: new Date().toISOString() };
};
`;

function jobNowStep(next: any | undefined): any {
  const step = codeStep('job_now', 'Data do job', {}, JOB_NOW_CODE, true);
  step.nextAction = next;
  return step;
}

/** Domingo 1970-01-04 mais o dia da semana do trigger (0 = domingo). */
function biweeklyAnchor(daysOfWeek: unknown): string {
  const raw = String(daysOfWeek ?? '0').split(/[,\s]+/)[0] ?? '0';
  const day = Number.parseInt(raw, 10);
  const shift = Number.isFinite(day) ? ((day % 7) + 7) % 7 : 0;
  const date = new Date(Date.UTC(1970, 0, 4 + shift));
  return date.toISOString().slice(0, 10);
}

function biweeklyWeeks(input: Record<string, any> | undefined): number | undefined {
  const unit = String(input?.time_unit ?? '').trim().toLowerCase();
  if (unit !== 'weeks' && unit !== 'week') return undefined;
  const n = Number.parseInt(String(input?.trigger_every ?? ''), 10);
  return Number.isFinite(n) && n > 1 ? n : undefined;
}

function biweeklyGate(next: any | undefined, weeks: number, anchor: string, timezone: string): any {
  const days = weeks * 7;
  const code = `export const code = async () => {
  // agenda: a cada ${weeks} semanas a partir de ${anchor}
  const primeiraExecucao = Date.parse('${anchor}T00:00:00Z');
  const hoje = new Intl.DateTimeFormat('sv-SE', {
    timeZone: '${timezone}',
  }).format(new Date());
  const dias = Math.round(
    (Date.parse(\`\${hoje}T00:00:00Z\`) - primeiraExecucao) / 86400000,
  );
  return { executar: dias >= 0 && dias % ${days} === 0 };
};
`;
  const check = codeStep('agenda_semana', 'Semana da agenda', {}, code, true);
  const router = {
    name: 'agenda_quinzena',
    skip: false,
    type: 'ROUTER',
    valid: true,
    settings: {
      branches: [
        {
          branchName: 'Semana da agenda',
          branchType: 'CONDITION',
          conditions: [[{
            firstValue: "{{agenda_semana['executar']}}",
            operator: 'BOOLEAN_IS_TRUE',
          }]],
        },
        { branchName: 'Outra semana', branchType: 'FALLBACK' },
      ],
      executionType: 'EXECUTE_FIRST_MATCH',
    },
    children: [next ?? null, null],
    displayName: 'Agenda a cada N semanas',
    lastUpdatedDate: NOW,
  };
  check.nextAction = router;
  return check;
}

function fillSheetsFindRows(
  target: MapTarget,
  input: Record<string, any>,
  sourceInput: Record<string, any>,
  ctx: Ctx,
): Record<string, any> {
  if (target.piece !== GOOGLE_SHEETS_PIECE || target.name !== 'find_rows') return input;
  const data = sourceInput.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data).filter((key) => data[key] !== '=skip' && data[key] != null && data[key] !== '');
    if (keys.length === 1 && (input.columnName == null || input.columnName === '')) {
      input.columnName = keys[0];
      if (input.searchValue == null || input.searchValue === '') {
        input.searchValue = deepConvert(data[keys[0]!], ctx);
      }
    }
  }
  if (input.matchCase == null || input.matchCase === '') input.matchCase = true;
  if (input.headerRow == null || input.headerRow === '') input.headerRow = true;
  return input;
}

const SLACK_VIEWS = 'https://slack.com/api/views.';

function slackPlain(text: unknown, ctx: Ctx): { type: 'plain_text'; text: unknown; emoji: true } | undefined {
  if (text == null || text === '') return undefined;
  return { type: 'plain_text', text: deepConvert(text, ctx), emoji: true };
}

function slackFlag(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function slackOptions(options: unknown, ctx: Ctx): Array<{ text: { type: 'plain_text'; text: unknown; emoji: true }; value: unknown }> | undefined {
  if (!Array.isArray(options) || !options.length) return undefined;
  return options.map((option) => ({
    text: slackPlain(option?.title ?? option?.value ?? '', ctx)!,
    value: deepConvert(option?.value ?? '', ctx),
  }));
}

function slackModalElement(block: Record<string, any>, ctx: Ctx): Record<string, any> {
  const actionId = block.block_id || 'action';
  if (block.block_type === 'plain_text_input' || block.block_type === 'multiline_plain_text_input') {
    const element: Record<string, any> = { type: 'plain_text_input', action_id: actionId };
    if (block.block_type === 'multiline_plain_text_input') element.multiline = true;
    const placeholder = slackPlain(block.placeholder_text, ctx);
    if (placeholder) element.placeholder = placeholder;
    if (block.max_length != null && block.max_length !== '') element.max_length = Number(block.max_length);
    return element;
  }
  if (block.block_type === 'datepicker_input') {
    const element: Record<string, any> = { type: 'datepicker', action_id: actionId };
    const placeholder = slackPlain(block.placeholder_text, ctx);
    if (placeholder) element.placeholder = placeholder;
    return element;
  }
  const menu = String(block.menu_type || (block.block_type === 'radio_buttons_input' ? 'radio_buttons' : 'static_select'));
  const element: Record<string, any> = {
    type: block.block_type === 'radio_buttons_input' ? 'radio_buttons' : menu,
    action_id: actionId,
  };
  const placeholder = slackPlain(block.placeholder_text, ctx);
  if (placeholder) element.placeholder = placeholder;
  const users = menu.includes('users');
  const external = menu.includes('external');
  if (!users && !external) {
    const options = slackOptions(block.options, ctx);
    if (options) element.options = options;
  }
  if (external) element.min_query_length = 0;
  if (block.max_selected_items != null && block.max_selected_items !== '') {
    element.max_selected_items = Number(block.max_selected_items);
  }
  return element;
}

function slackModalBlock(block: Record<string, any>, ctx: Ctx): Record<string, any> | undefined {
  if (!block || typeof block !== 'object') return undefined;
  if (block.block_type === 'divider') return { type: 'divider' };
  if (block.block_type === 'section_with_text') {
    return { type: 'section', text: { type: 'mrkdwn', text: deepConvert(block.section_text ?? '', ctx) } };
  }
  if (block.block_type === 'section_with_button') {
    return {
      type: 'section',
      text: { type: 'mrkdwn', text: deepConvert(block.section_text ?? '', ctx) },
      accessory: {
        type: 'button',
        text: slackPlain(block.button_title ?? 'Abrir', ctx),
        ...(block.url != null && block.url !== '' ? { url: deepConvert(block.url, ctx) } : {}),
        action_id: block.block_id || 'button',
      },
    };
  }
  const label = slackPlain(block.label_text, ctx);
  if (!label) return undefined;
  const input: Record<string, any> = {
    type: 'input',
    block_id: block.block_id,
    label,
    element: slackModalElement(block, ctx),
  };
  const optional = slackFlag(block.optional);
  if (optional != null) input.optional = optional;
  const hint = slackPlain(block.hint_text, ctx);
  if (hint) input.hint = hint;
  return input;
}

function slackModalView(view: Record<string, any>, ctx: Ctx): Record<string, any> {
  const submit = view.submit_view && typeof view.submit_view === 'object' ? view.submit_view : {};
  const out: Record<string, any> = {
    type: 'modal',
    title: slackPlain(view.modal_title ?? 'Modal', ctx),
    blocks: (Array.isArray(view.blocks) ? view.blocks : [])
      .map((block) => slackModalBlock(block, ctx))
      .filter(Boolean),
  };
  const submitText = slackPlain(submit.submit_text, ctx);
  if (submitText) out.submit = submitText;
  const closeText = slackPlain(submit.close_text, ctx);
  if (closeText) out.close = closeText;
  const notify = slackFlag(submit.notify_on_close);
  if (notify != null) out.notify_on_close = notify;
  const clear = slackFlag(submit.clear_on_close);
  if (clear != null) out.clear_on_close = clear;
  return out;
}

function triggerLine(ctx: Ctx): string | undefined {
  for (const [line, bound] of ctx.asToName) {
    const name = typeof bound === 'string' ? bound : bound.name;
    if (name === 'trigger') return line;
  }
  return undefined;
}

/** Workato `block_kit_modals` abre/atualiza um modal. Vira `views.open` / `views.update` / `views.push`. */
function fillSlackModal(input: Record<string, any>, sourceInput: Record<string, any>, ctx: Ctx): Record<string, any> {
  const action = String(sourceInput.modal_action_type || 'open');
  const urlAction = action === 'update' || action === 'push' ? action : 'open';
  let view = sourceInput.view;
  if (typeof view === 'string') {
    try {
      view = JSON.parse(view);
    } catch {
      view = {};
    }
  }
  const slackView = slackModalView(view && typeof view === 'object' ? view : {}, ctx);
  const body: Record<string, any> = { view: slackView };
  if (urlAction === 'update') {
    if (sourceInput.view_id != null && sourceInput.view_id !== '') body.view_id = deepConvert(sourceInput.view_id, ctx);
  } else {
    const triggerId = sourceInput.trigger_id;
    if (triggerId != null && triggerId !== '') body.trigger_id = deepConvert(triggerId, ctx);
    else {
      const line = triggerLine(ctx);
      if (line) {
        body.trigger_id = deepConvert(
          `#{_dp('${JSON.stringify({ pill_type: 'output', provider: 'slack_bot', line, path: ['context', 'trigger_id'] })}')}`,
          ctx,
        );
      }
    }
  }
  return {
    ...input,
    method: 'POST',
    url: `${SLACK_VIEWS}${urlAction}`,
    headers: { 'Content-Type': 'application/json' },
    queryParams: {},
    body_type: 'json',
    useUserToken: false,
    body,
  };
}

function fillHttpSend(input: Record<string, any>, sourceInput: Record<string, any>, ctx: Ctx): Record<string, any> {
  const request = sourceInput.request && typeof sourceInput.request === 'object' ? sourceInput.request : sourceInput;
  if (input.headers == null || (typeof input.headers === 'object' && !Object.keys(input.headers).length)) {
    input.headers = workatoHeaders(request.headers, ctx);
  }
  const contentType = request.content_type;
  if (contentType && contentType !== '=skip' && input.headers['Content-Type'] == null) {
    input.headers['Content-Type'] = deepConvert(contentType, ctx);
  }
  if (input.queryParams == null) input.queryParams = {};
  if (input.authType == null) input.authType = 'none';
  if (input.body && typeof input.body === 'object' && typeof input.body.data === 'string') {
    input.body_type = 'raw';
  }
  return input;
}

const PIPEFY_GRAPHQL_URL = 'https://api.pipefy.com/graphql';
const PIPEFY_GRAPHQL_TARGET: MapTarget = { piece: PIPEFY_PIECE, name: 'custom_api_call', kind: 'action' };

/**
 * Documentos do conector GraphQL da Workato. O objeto da receita é o campo
 * (`updateTableRecord{}` → updateTableRecord). `$input` recebe `argument_input`.
 */
const PIPEFY_GRAPHQL_DOCUMENTS: Record<string, { kind: 'query' | 'mutation'; document: string; variables: 'input' | 'id' }> = {
  updateTableRecord: {
    kind: 'mutation',
    variables: 'input',
    document: `mutation updateTableRecord($input: UpdateTableRecordInput!) {
  updateTableRecord(input: $input) {
    clientMutationId
    table_record { id title due_date }
  }
}`,
  },
  updateFieldsValues: {
    kind: 'mutation',
    variables: 'input',
    document: `mutation updateFieldsValues($input: UpdateFieldsValuesInput!) {
  updateFieldsValues(input: $input) {
    success
    clientMutationId
  }
}`,
  },
  card: {
    kind: 'query',
    variables: 'id',
    document: `query card($id: ID!) {
  card(id: $id) {
    id
    title
    current_phase { id name }
    fields { name value report_value }
    parent_relations { name cards { id title } }
  }
}`,
  },
  createInboxEmail: {
    kind: 'mutation',
    variables: 'input',
    document: `mutation createInboxEmail($input: CreateInboxEmailInput!) {
  createInboxEmail(input: $input) {
    clientMutationId
    inbox_email { id }
  }
}`,
  },
  createComment: {
    kind: 'mutation',
    variables: 'input',
    document: `mutation createComment($input: CreateCommentInput!) {
  createComment(input: $input) {
    clientMutationId
    comment { id text }
  }
}`,
  },
};

function graphqlObjectName(object: unknown): string {
  return String(object ?? '')
    .trim()
    .replace(/\{\}\s*$/, '')
    .trim();
}

function graphqlFieldName(objectName: string): string {
  const cleaned = objectName.replace(/[^A-Za-z0-9_]/g, '');
  if (!cleaned) return 'unknownOperation';
  if (/^[0-9]/.test(cleaned)) return `op_${cleaned}`;
  return cleaned;
}

function convertArgumentInput(raw: unknown, ctx: Ctx): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === '=skip') continue;
    out[key] = deepConvert(value, ctx);
  }
  return out;
}

/** Conector GraphQL da Workato usa a conexão do Pipefy, não o piece-graphql. */
function buildPipefyGraphql(
  name: string,
  display: string,
  opKey: string,
  sourceInput: Record<string, any>,
  ctx: Ctx,
): any {
  const objectName = graphqlObjectName(sourceInput.object);
  const known = PIPEFY_GRAPHQL_DOCUMENTS[objectName];
  const field = graphqlFieldName(objectName);
  const op = collapseOpKey(opKey).split('/')[1] ?? '';
  const kind = known?.kind ?? (op === 'query' ? 'query' : 'mutation');
  const variableMode = known?.variables ?? (kind === 'query' ? 'id' : 'input');
  const document =
    known?.document ??
    (kind === 'query'
      ? `query ${field}($id: ID) {\n  ${field}(id: $id) {\n    id\n  }\n}`
      : `mutation ${field}($input: JSON) {\n  ${field}(input: $input) {\n    clientMutationId\n  }\n}`);
  const args = convertArgumentInput(sourceInput.argument_input, ctx);
  const idRaw = sourceInput.argument_id;
  const id = idRaw != null && idRaw !== '' && idRaw !== '=skip' ? deepConvert(idRaw, ctx) : undefined;
  let variables: Record<string, any>;
  if (variableMode === 'id') variables = { id: id ?? args.id ?? '' };
  else {
    if (id != null && args.id == null) args.id = id;
    variables = { input: args };
  }
  if (!known) {
    const shown = objectName || '(vazio)';
    ctx.todos.push(`GRAPHQL (${name}): objeto "${shown}" sem documento conhecido.`);
    pushReviewNote(
      ctx,
      'GRAPHQL',
      `Passo \`${name}\`. Objeto GraphQL desconhecido: \`${shown}\`. O passo usa custom_api_call do Pipefy; conferir o schema antes de publicar.`,
      shown,
      name,
    );
  }
  ctx.piecesUsed.add(PIPEFY_PIECE);
  let input: Record<string, any> = {
    method: 'POST',
    url: PIPEFY_GRAPHQL_URL,
    headers: {},
    queryParams: {},
    body_type: 'json',
    body: { query: document, variables },
  };
  input = resolveFormulas(input, ctx, name, sourceInput);
  envelopeDynamicProps(input, ctx, PIPEFY_GRAPHQL_TARGET);
  const missing = missingRequiredProps(ctx, PIPEFY_GRAPHQL_TARGET, input);
  if (missing.length) {
    ctx.todos.push(`PROPS (${name}): preencher obrigatorias ausentes: ${missing.join(', ')}.`);
  }
  return {
    name,
    skip: false,
    type: 'PIECE',
    valid: missing.length === 0,
    settings: {
      input,
      pieceName: PIPEFY_PIECE,
      actionName: 'custom_api_call',
      pieceVersion: pieceVersion(ctx, PIPEFY_PIECE),
      propertySettings: pipefyPropertySettings(input, undefined),
      errorHandlingOptions: ERR(),
    },
    displayName: display,
    lastUpdatedDate: NOW,
  };
}

const DATA_MAPPER_PIECE = '@activepieces/piece-data-mapper';

/**
 * Mapper by Workato: `input.data` é o mapa campo de saída → fórmula/pill.
 * Cada chave entra em `mapping`, inclusive quando a pill aponta para o Pipefy.
 */
function workatoMapperMapping(data: unknown, ctx: Ctx): { mapping: Record<string, any>; empty: boolean } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { mapping: {}, empty: true };
  const mapping: Record<string, any> = {};
  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    if (value === '=skip') continue;
    mapping[key] = deepConvert(value, ctx);
  }
  return { mapping, empty: Object.keys(mapping).length === 0 };
}

function buildAction(step: ParsedStep, ctx: Ctx): any {
  const variable = buildVariableStep(step, ctx);
  if (variable === OMIT_STEP) return null;
  if (variable) return variable;

  const opKey = step.opKey ?? `${step.provider}/${step.name}`;
  let entry = lookupMap(ctx.merged, opKey);
  let sourceInput = resolveZeroPhaseInput(step.input ?? {}, step.phasePickLabel, ctx.phasesByPipe);
  if (entry?.target && collapseOpKey(opKey) === 'clock/wait_until_time') {
    const resolved = resolveWaitUntilTime(sourceInput, ctx.merged);
    entry = resolved.entry;
    sourceInput = resolved.input;
  }
  // Ruby que só dorme vira a Delay Utility; o resto segue para tradução manual.
  const rubySleep = opKey.endsWith('/invoke_custom_ruby_code')
    ? resolveRubySleep(sourceInput, ctx.merged)
    : null;
  if (rubySleep) {
    entry = rubySleep.entry;
    sourceInput = rubySleep.input;
  }
  const name = stepName(step, ctx);
  noteWorkatoDataTable(ctx, step, name);
  const display =
    step.comment ||
    (collapseOpKey(opKey) === 'file_connector/read_file' ? 'Get file from URL' : step.name) ||
    opKey;

  if (collapseOpKey(opKey) === 'csv_parser/parse_csv') {
    return buildParseCsv(name, display, sourceInput, ctx);
  }
  if (collapseOpKey(opKey) === 'soap/create_message') {
    return buildSoapCreateMessage(name, display, sourceInput, ctx);
  }
  if (collapseOpKey(opKey) === 'workato_template/create_document') {
    return buildMessageTemplate(name, display, sourceInput, ctx);
  }
  if (collapseOpKey(opKey) === 'logger/log_message') {
    return buildLogger(name, display, sourceInput, ctx);
  }
  if (collapseOpKey(opKey) === 'workato_list/create_list') {
    return buildCreateList(name, display, step, ctx);
  }
  if (
    collapseOpKey(opKey) === 'workato_list/accumulate_list_items' &&
    step.as &&
    ctx.loopedListLines.has(step.as)
  ) {
    return buildAccumulateList(name, display, step, ctx);
  }
  if (collapseOpKey(opKey) === 'py_eval/invoke_custom_py_code' && isXlsxToCsvPython(String(step.input?.code ?? ''))) {
    return buildXlsxPython(name, display, step, ctx);
  }
  if (collapseOpKey(opKey) === 'py_eval/invoke_custom_py_code' && isNodeIdsPython(String(step.input?.code ?? ''))) {
    return buildNodeIdsPython(name, display, step, ctx);
  }
  if (collapseOpKey(opKey) === 'py_eval/invoke_custom_py_code') {
    const python = String(step.input?.code ?? '');
    if (pythonRandomNineDigits(python)) {
      return codeStep(name, display, {}, pythonRandomNineDigitsCode(), true);
    }
    const sleepMs = pythonSleepMs(python);
    if (sleepMs != null) return buildPythonSleep(name, display, step, ctx, sleepMs);
  }
  if (opKey.endsWith('/get_cards_by_field') && includeDoneIsFalse(sourceInput)) {
    return buildOpenCardsSearch(name, display, sourceInput, ctx);
  }
  if (opKey === PIPESIGN_GET_DOCUMENT) {
    return buildPipesignGetDocument(name, display, sourceInput, ctx);
  }

  const channelOp = collapseOpKey(opKey);
  if (channelOp === 'email/send_mail' || channelOp === 'sms/send_sms') {
    const email = channelOp === 'email/send_mail';
    ctx.todos.push(
      email
        ? `EMAIL (${name}): Email by Workato nao migra (nao vira SMTP nem Gmail). Avisar e seguir o canvas.`
        : `SMS (${name}): SMS by Workato nao migra (nao vira Twilio). Avisar e seguir o canvas.`,
    );
    pushReviewNote(
      ctx,
      email ? 'EMAIL' : 'SMS',
      email
        ? 'Email by Workato nao migra — nao usar piece-smtp nem Gmail. Recriar o envio no iPaaS. O canvas segue nos passos mapeados.'
        : 'SMS by Workato nao migra — nao usar piece-twilio. Recriar o envio no iPaaS. O canvas segue nos passos mapeados.',
      '',
      name,
    );
    const input = resolveFormulas(convInput(sourceInput, undefined, ctx), ctx, name, sourceInput);
    return todoPieceStep(name, display, input);
  }

  // manual (Ruby) / builtin (code|loop|...) -> step CODE
  if (!rubySleep && (entry?.manual || entry?.builtin || opKey.endsWith('/invoke_custom_ruby_code'))) {
    const isRuby = opKey.endsWith('/invoke_custom_ruby_code');
    const isPython = opKey.endsWith('/invoke_custom_py_code');
    const isJs = opKey.endsWith('/invoke_custom_js_code');
    const language = codeLanguage(opKey);
    // Ruby e Python leem os campos reais em code_input.data. O stub achata isso em inputs.<campo>.
    const rawInput = isRuby || isPython || isJs ? (step.input?.code_input?.data ?? {}) : sourceInput;
    const kind = entry?.builtin === 'loop' ? 'acumulador/loop' : isRuby ? 'Ruby' : isPython ? 'Python' : 'logica';
    const codeInput = resolveFormulas(convInput(rawInput, undefined, ctx), ctx, name);
    const source = String(step.input?.code ?? '');
    const lifted = liftCodeSecrets(codeInput, source, ctx, name);
    if (isRuby && isBusinessDaysRuby(lifted.source)) {
      return codeStep(name, display, lifted.input, businessDaysCode(), !hasTodoMarker(lifted.input));
    }
    if (isRuby) {
      const random = parseRubyRandomSleep(lifted.source);
      if (random) return codeStep(name, display, {}, randomSleepCode(random), true);
    }
    if (isJs) {
      const wrapped = wrapJsEvalMain(lifted.source);
      if (wrapped) {
        return codeStep(name, display, lifted.input, wrapped, !hasTodoMarker(lifted.input));
      }
    }
    ctx.todos.push(`CODE (${name}): traduzir "${opKey}" (${kind}) para JS. ${language} original embutido no step.`);
    return codeStep(name, display, lifted.input, buildCodeStub(opKey, lifted.source, language));
  }

  if (collapseOpKey(opKey).startsWith('graphql/')) {
    return buildPipefyGraphql(name, display, opKey, sourceInput, ctx);
  }

  if (!entry || !entry.target) {
    // Passo desligado que nao tem piece: o cartao vazio do bloco de erro
    // ("Select an app and action", skip: true). Nao vira TODO no flow.
    if (step.skip) return null;
    // Word "Get document content" nao tem action com o mesmo provider e os
    // mesmos inputs. O passo sai do canvas; o que vem depois continua.
    if (collapseOpKey(opKey) === 'word/get_document_content') {
      return buildChain(step.children, ctx) ?? null;
    }
    ctx.todos.push(`NAO MAPEADA (${name}): "${opKey}" -> definir mapa (add-map).`);
    return todoPieceStep(name, display, sourceInput);
  }

  const t = entry.target;
  ctx.piecesUsed.add(t.piece);
  noteLookupTable(ctx, opKey, sourceInput, name);
  const shaped = t.piece === SUBFLOW_PIECE ? applySubflowAction(opKey, t.name, sourceInput, ctx, name) : null;
  // callFlow/returnResponse ja resolvem a formula la dentro. Resolver de novo
  // criava um step CODE orfao. Nos outros passos a formula espera os fill*:
  // headers, searchValue e props copiadas entram no mesmo step CODE.
  let input = shaped ?? convInput(sourceInput, entry, ctx);
  const omie = fillOmieHttp(opKey, t, input, sourceInput, ctx, name);
  if (omie) input = omie;
  if (t.piece === PIPEFY_PIECE) input = withPipefyCardFields(t.name, input);
  if (collapseOpKey(opKey) === 'slack/block_kit_modals' && t.name === 'custom_api_call') {
    input = fillSlackModal(input, sourceInput, ctx);
    pushReviewNote(
      ctx,
      'MODAL',
      'A doc do Slack lista o trigger New Modal Interaction (new-modal-interaction): ele começa um flow quando o usuário envia (view_submission) ou fecha (view_closed) o modal. Não abre o modal. Este passo Workato abre o modal (block_kit_modals), então foi convertido para callback views.open/update/push. Os campos preenchidos saem nesse trigger, não na resposta do POST.',
      '',
      name,
    );
  }
  if (t.piece === '@activepieces/piece-http' && t.name === 'send_request') {
    input = fillHttpSend(input, sourceInput, ctx);
    const connection = ctx.connectionsByProvider[step.provider ?? ''];
    if (connection) {
      pushReviewNote(
        ctx,
        'CONNECTION',
        [
          `Passo Workato ${step.number ?? '?'} (${step.comment || step.name || opKey}) usava uma conexão HTTP (${connection}).`,
          'O piece HTTP do iPaaS não importa conexão: o flow sai com authType "none".',
          'Recriar a autenticação (Basic, Bearer ou headers) neste step. Credenciais não vêm na receita.',
        ].join('\n'),
        '',
        name,
      );
    }
  }
  input = fillSheetsInsertRow(t, input, sourceInput);
  input = fillSheetsFindRows(t, input, sourceInput, ctx);
  input = fillKnownProps(t, input, sourceInput);
  const workatoMapper = t.piece === DATA_MAPPER_PIECE && t.name === 'advanced_mapping';
  let mapperEmpty = false;
  if (workatoMapper) {
    const mapped = workatoMapperMapping(sourceInput.data, ctx);
    input = { mapping: mapped.mapping };
    mapperEmpty = mapped.empty;
  }
  if (!shaped && !omie) {
    input = resolveFormulas(input, ctx, name, workatoMapper ? { mapping: sourceInput.data } : sourceInput);
  }
  if (mapperEmpty) {
    pushReviewNote(ctx, 'MAPPER', 'O Mapper by Workato não tinha data.', '', name);
  }
  const docsBatch = googleDocsBatchUpdate(t, input);
  if (docsBatch) {
    const batchTarget: MapTarget = { piece: t.piece, name: 'custom_api_call', kind: 'action' };
    const batchMissing = missingRequiredProps(ctx, batchTarget, docsBatch);
    return {
      name,
      skip: false,
      type: 'PIECE',
      valid: batchMissing.length === 0 && !hasTodoMarker(docsBatch),
      settings: {
        input: docsBatch,
        pieceName: t.piece,
        actionName: 'custom_api_call',
        pieceVersion: pieceVersion(ctx, t.piece),
        propertySettings: settingsFor(t.piece, 'custom_api_call', docsBatch),
        errorHandlingOptions: ERR(),
      },
      displayName: display,
      lastUpdatedDate: NOW,
    };
  }
  if (t.piece === PIPEFY_PIECE && t.name === 'updateCard' && phaseFieldsBlank(input.phaseFields)) {
    const original = JSON.stringify(step.input ?? {}, null, 2);
    pushReviewNote(
      ctx,
      'UPDATE',
      [
        `Passo Workato ${step.number ?? '?'} (${step.comment || step.name || opKey}) nao foi transportado.`,
        'O update nao traz valor de campo. A Workato ignora os opcionais vazios e o card nao muda.',
        '',
        `${step.provider ?? ''}/${step.name ?? ''}`,
        original,
      ].join('\n'),
    );
    ctx.noteAnchorPending = ctx.canvasNotes.length - 1;
    return null;
  }
  if (collapseOpKey(opKey) === 'file_connector/uncompress_file') {
    if (input.file == null && input.file_contents != null) {
      input.file = input.file_contents;
      delete input.file_contents;
    }
    delete input.compression_format;
  }
  if (slackSendWantsFlowLink(t, sourceInput)) input.mentionOriginFlow = true;
  const missing = waivedMissing(t, input, sourceInput, missingRequiredProps(ctx, t, input));
  if (missing.length) {
    ctx.todos.push(`PROPS (${name}): preencher obrigatorias ausentes: ${missing.join(', ')}.`);
  }
  const unresolved: string[] = [];
  collectTodoMarkers(input, '', unresolved);
  if (unresolved.length) {
    // Formula que o compilador nao cobriu continua visivel no campo; o texto
    // Workato original ajuda quem for traduzir a mao.
    const formulas: string[] = [];
    collectFormulas(sourceInput, '', formulas);
    if (formulas.length) {
      ctx.todos.push(
        `FORMULA (${name}): traduzir formula Workato sem equivalente em template AP: ${formulas.join(', ')}.`,
      );
    }
    ctx.todos.push(
      `PILL (${name}): referencia que nao resolve no AP em ${unresolved.join(', ')} — revisar.`,
    );
  }
  const listAdd = t.name === 'custom_api_call' || t.name === 'send_request' ? updateListFieldFromGraphql(input) : null;
  if (listAdd) {
    ctx.piecesUsed.add(PIPEFY_PIECE);
    const listTarget: MapTarget = { piece: PIPEFY_PIECE, name: 'updateListField', kind: 'action' };
    const listMissing = missingRequiredProps(ctx, listTarget, listAdd);
    return {
      name,
      skip: false,
      type: 'PIECE',
      valid: listMissing.length === 0 && !JSON.stringify(listAdd).includes('TODO'),
      settings: {
        input: listAdd,
        pieceName: PIPEFY_PIECE,
        actionName: 'updateListField',
        pieceVersion: pieceVersion(ctx, PIPEFY_PIECE),
        propertySettings: propertySettings(listAdd),
        errorHandlingOptions: ERR(),
      },
      displayName: display,
      lastUpdatedDate: NOW,
    };
  }
  return {
    name,
    skip: false,
    type: 'PIECE',
    // Formula/pill residual ja viram todo; valid e so prop obrigatoria do mesmo nome.
    valid: missing.length === 0,
    settings: {
      input,
      pieceName: t.piece,
      actionName: t.name,
      pieceVersion: pieceVersion(ctx, t.piece),
      propertySettings:
        t.piece === PIPEFY_PIECE ? pipefyPropertySettings(input, step.inputFields) : settingsFor(t.piece, t.name, input),
      errorHandlingOptions: ERR(),
    },
    displayName: display,
    lastUpdatedDate: NOW,
  };
}

const WORKATO_OPERAND_TO_AP: Record<string, { operator: string; unary?: boolean; approximated?: boolean }> = {
  equals_to: { operator: 'TEXT_EXACTLY_MATCHES' },
  not_equals_to: { operator: 'TEXT_DOES_NOT_EXACTLY_MATCH' },
  contains: { operator: 'TEXT_CONTAINS' },
  not_contains: { operator: 'TEXT_DOES_NOT_CONTAIN' },
  does_not_contain: { operator: 'TEXT_DOES_NOT_CONTAIN' },
  starts_with: { operator: 'TEXT_START_WITH' },
  not_starts_with: { operator: 'TEXT_DOES_NOT_START_WITH' },
  ends_with: { operator: 'TEXT_ENDS_WITH' },
  not_ends_with: { operator: 'TEXT_DOES_NOT_END_WITH' },
  present: { operator: 'EXISTS', unary: true },
  is_present: { operator: 'EXISTS', unary: true },
  is_not_present: { operator: 'DOES_NOT_EXIST', unary: true },
  // `blank` do Workato e nil OU string vazia. No engine do AP,
  // DOES_NOT_EXIST e `undefined || null || ''` — equivalencia fiel.
  blank: { operator: 'DOES_NOT_EXIST', unary: true },
  is_blank: { operator: 'DOES_NOT_EXIST', unary: true },
  not_blank: { operator: 'EXISTS', unary: true },
  is_empty: { operator: 'DOES_NOT_EXIST', unary: true },
  empty: { operator: 'DOES_NOT_EXIST', unary: true },
  is_true: { operator: 'BOOLEAN_IS_TRUE', unary: true },
  is_false: { operator: 'BOOLEAN_IS_FALSE', unary: true },
  // Workato `is_not_true` tambem e verdadeiro para nil; BOOLEAN_IS_FALSE nao.
  is_not_true: { operator: 'BOOLEAN_IS_FALSE', unary: true, approximated: true },
  greater_than: { operator: 'NUMBER_IS_GREATER_THAN' },
  less_than: { operator: 'NUMBER_IS_LESS_THAN' },
};

function describeConditions(step: ParsedStep): string {
  const c = asConditionsInput(step.input)?.conditions;
  if (Array.isArray(c)) return c.map((x) => `${x.lhs} ${x.operand} ${x.rhs}`).join(' / ');
  return 'ver receita';
}

function cellGroups(
  condition: Record<string, any>,
  review: boolean,
): { groups: any[][]; review: boolean } {
  return { groups: [[condition]], review };
}

function productGroups(left: any[][], right: any[][]): any[][] {
  const out: any[][] = [];
  for (const a of left) {
    for (const b of right) out.push([...a, ...b]);
  }
  return out;
}

function convertCondition(
  raw: WorkatoCondition | undefined,
  ctx: Ctx,
): { groups: any[][]; review: boolean } {
  const operand = String(raw?.operand ?? '');
  const mapped = WORKATO_OPERAND_TO_AP[operand];
  const resolve = loopItemResolver(ctx);
  const include = parseIncludeFormula(String(raw?.lhs ?? ''));
  if (include && (operand === 'is_true' || operand === 'is_false')) {
    const firstValue = pills(include.needleRaw, ctx, resolve);
    // Template nao resolvido nao entra aqui: quem monta o router varre os
    // marcadores DEPOIS de tentar traduzir as formulas para step CODE.
    const review = false;
    const cells = include.values.map((value) => ({
      operator: operand === 'is_true' ? 'TEXT_EXACTLY_MATCHES' : 'TEXT_DOES_NOT_EXACTLY_MATCH',
      firstValue,
      secondValue: value,
      caseSensitive: !include.caseFold,
    }));
    if (operand === 'is_true') return { groups: cells.map((cell) => [cell]), review };
    return { groups: [cells], review };
  }

  const rawLhs = String(raw?.lhs ?? '');
  const rawRhs = String(raw?.rhs ?? '');
  const foldCase = !mapped || mapped.operator.startsWith('TEXT_');
  const peeledLhs = foldCase ? peelTrailingCaseMethod(rawLhs) : null;
  const peeledRhs = foldCase ? peelTrailingCaseMethod(rawRhs) : null;
  const caseMethod = peeledLhs?.method ?? peeledRhs?.method;
  const lhs = peeledLhs?.inner ?? rawLhs;
  const firstValue = pills(lhs, ctx, resolve);
  const wrapTextCase = (value: string) => (caseMethod ? wrapApCase(value, caseMethod) : value);
  if (!mapped) {
    ctx.todos.push(
      `OPERANDO (${operand || 'vazio'}): sem equivalente no AP; virou igualdade — revisar.`,
    );
    return cellGroups(
      {
        operator: 'TEXT_EXACTLY_MATCHES',
        firstValue: caseMethod ? wrapApCase(firstValue, caseMethod) : firstValue,
        secondValue: caseMethod
          ? wrapApCase(pills(peeledRhs?.inner ?? rawRhs, ctx, resolve), caseMethod)
          : pills(rawRhs, ctx, resolve),
        caseSensitive: false,
      },
      true,
    );
  }
  if (mapped.approximated) {
    ctx.todos.push(
      `OPERANDO (${operand}): traduzido como ${mapped.operator} — revisar o caso nil.`,
    );
  }
  if (mapped.unary) {
    return cellGroups({ operator: mapped.operator, firstValue }, false);
  }
  const condition: Record<string, any> = {
    operator: mapped.operator,
    firstValue: wrapTextCase(firstValue),
    secondValue: wrapTextCase(pills(peeledRhs?.inner ?? rawRhs, ctx, resolve)),
  };
  if (mapped.operator.startsWith('TEXT_')) condition.caseSensitive = false;
  return cellGroups(condition, false);
}

/** Sobrou marcador `TODO_` em algum lugar do valor convertido? */
function hasTodoMarker(value: unknown): boolean {
  const found: string[] = [];
  collectTodoMarkers(value, '', found);
  return found.length > 0;
}

/** conditions do Workato (lista + operand and/or) -> DNF do Activepieces. */
function buildConditionGroups(
  rawInput: WorkatoConditionsInput | undefined,
  ctx: Ctx,
): { groups: any[][]; review: boolean } {
  const raw = conditionsOf(rawInput);
  const join = String(rawInput?.operand ?? 'and').toLowerCase();
  const converted = raw.map((item) => convertCondition(item, ctx));
  const review = converted.some((item) => item.review);
  if (!converted.length) return { groups: [[]], review: true };
  if (join === 'or') return { groups: converted.flatMap((item) => item.groups), review };
  let groups = converted[0]!.groups;
  for (const next of converted.slice(1)) groups = productGroups(groups, next.groups);
  return { groups, review };
}

interface IfBranch {
  conditionsInput: WorkatoConditionsInput | undefined;
  children: ParsedStep[];
}

/**
 * Reparte um `if` do Workato em ramos.
 *
 * Os `elsif` sao IRMAOS dentro do `block` do `if`, cada um carregando os
 * proprios filhos, e `else` e o ultimo irmao. O corpo do elsif mora em
 * `child.children` (o `block` do no); irmaos seguintes que nao sao elsif/else
 * ainda entram no ramo corrente, para cobrir as duas formas vistas no corpus.
 */
function splitBranches(step: ParsedStep): { branches: IfBranch[]; elseChildren: ParsedStep[] } {
  const branches: IfBranch[] = [{ conditionsInput: asConditionsInput(step.input), children: [] }];
  let elseChildren: ParsedStep[] = [];
  let seenElse = false;

  for (const child of step.children) {
    if (child.keyword === 'elsif' || child.keyword === 'elseif') {
      branches.push({
        conditionsInput: asConditionsInput(child.input),
        children: [...child.children],
      });
    } else if (child.keyword === 'else') {
      seenElse = true;
      elseChildren = child.children;
    } else if (!seenElse) {
      branches[branches.length - 1]!.children.push(child);
    }
  }
  return { branches, elseChildren };
}

/**
 * Para cada ramo do router (condicionais + fallback), diz se ele termina em
 * `stop`. Um ramo que para encerra o job: nada depois do `if` roda nesse caminho.
 */
function branchStopFlags(step: ParsedStep): boolean[] {
  const { branches, elseChildren } = splitBranches(step);
  return [
    ...branches.map((branch) => branchHasTerminatingStop(branch.children)),
    branchHasTerminatingStop(elseChildren),
  ];
}

/** `stop` desativado nao encerra nada: o ramo segue aberto. */
function stopsExecution(step: ParsedStep | undefined): boolean {
  return step?.keyword === 'stop' && !step.skip;
}

/** Qualquer `stop` ativo no ramo encerra o job; o que vier depois e morto. */
function branchHasTerminatingStop(children: ParsedStep[]): boolean {
  for (const child of children) {
    if (child.skip) continue;
    if (stopsExecution(child)) return true;
  }
  return false;
}

/** if / elsif... / else -> ROUTER com EXECUTE_FIRST_MATCH (mesma semantica). */
function buildRouter(step: ParsedStep, ctx: Ctx): any {
  const name = step.apName || nextName('router');
  const { branches, elseChildren } = splitBranches(step);
  const built = branches.map((branch) => buildConditionGroups(branch.conditionsInput, ctx));
  const groups = resolveFormulas(
    built.map((item) => item.groups),
    ctx,
    name,
  ) as any[][][];
  const conditions = groups.map((item) => ({ groups: item }));
  const review = built.some((item) => item.review) || hasTodoMarker(groups);

  if (review) {
    ctx.todos.push(`ROUTER (${name}): revisar condicoes do "if" (${describeConditions(step)}).`);
  }
  if (branches.length > 1) {
    ctx.todos.push(
      `ROUTER (${name}): ${branches.length - 1} "elsif" viraram ramos do router — conferir a ordem.`,
    );
  }

  return {
    name,
    skip: false,
    type: 'ROUTER',
    valid: !review,
    settings: {
      branches: [
        ...branches.map((_, index) => ({
          branchName: index === 0 ? 'Se verdadeiro' : `Senao se (${index})`,
          branchType: 'CONDITION' as const,
          conditions: conditions[index]!.groups,
        })),
        { branchName: 'Senao', branchType: 'FALLBACK' as const },
      ],
      executionType: 'EXECUTE_FIRST_MATCH',
    },
    children: [
      ...branches.map((branch) => buildChain(branch.children, ctx) ?? null),
      buildChain(elseChildren, ctx) ?? null,
    ],
    displayName: step.comment || 'Condicao',
    lastUpdatedDate: NOW,
  };
}

function listDeclFromSource(source: unknown, ctx: Ctx): VarDecl | undefined {
  const pill = firstPill(source);
  if (!pill?.line) return undefined;
  const decl = ctx.vars.decls.get(String(pill.line));
  return decl?.kind === 'list' ? decl : undefined;
}

function buildLoop(step: ParsedStep, ctx: Ctx): any {
  const name = step.apName || nextName('loop');
  // A colecao e avaliada no escopo de FORA: o source de um loop aninhado
  // referencia o item do loop externo, nao o proprio.
  let items = step.source
    ? resolveFormulas(pills(step.source, ctx), ctx, name)
    : '{{TODO_lista}}';
  const listDecl = listDeclFromSource(step.source, ctx);
  if (listDecl && !items.includes('TODO')) {
    const parsed = nextName('var_list');
    const code = codeStep(parsed, `Ler lista "${listDecl.label}"`, { list: items }, listReadCode(), true);
    ctx.pendingCode.push(code);
    items = `{{${parsed}}}`;
  }
  if (!step.source || items.includes('TODO')) {
    ctx.todos.push(`LOOP (${name}): definir a lista de itens (items).`);
  }

  ctx.loopScope.push({ collection: items, item: `${name}.item` });
  const firstLoopAction = buildChain(step.children, ctx);
  ctx.loopScope.pop();

  return {
    name,
    skip: false,
    type: 'LOOP_ON_ITEMS',
    valid: Boolean(step.source) && !items.includes('TODO'),
    settings: { items },
    displayName: step.comment || 'Para cada item',
    firstLoopAction,
    lastUpdatedDate: NOW,
  };
}

/**
 * Expressao Workato em forma legivel, para texto de TODO.
 *
 * Nao serve para gerar template: o objetivo e a pessoa entender a condicao sem
 * reabrir a receita.
 */
function readableExpr(raw: unknown, ctx: Ctx): string {
  const out = pills(String(raw ?? ''), ctx).replace(
    /_dp\('(.+?)'\)/g,
    (_match, json: string) => {
      try {
        const dp = JSON.parse(json) as { line?: string; provider?: string; path?: unknown };
        const base = (dp.line && stepBindingName(ctx.asToName.get(dp.line))) || dp.provider || 'passo';
        const path = Array.isArray(dp.path)
          ? dp.path.filter((p): p is string => typeof p === 'string').join('.')
          : '';
        return path ? `${base}.${path}` : String(base);
      } catch {
        return 'passo';
      }
    },
  );
  return out
    .replace(/\{\{\s*TODO_FORMULA\((.*)\)\s*\}\}/gs, '$1')
    .replace(/TODO_FORMULA\((.*)\)/gs, '$1')
    .replace(/^=/, '')
    .trim();
}

function describeReadable(input: WorkatoConditionsInput | undefined, ctx: Ctx): string {
  const raw = conditionsOf(input);
  if (!raw.length) return 'sem condicao declarada';
  const join = String(input?.operand ?? 'and').toLowerCase() === 'or' ? ' OU ' : ' E ';
  return raw
    .map((item) =>
      `${readableExpr(item?.lhs, ctx)} ${item?.operand ?? '?'} ${readableExpr(item?.rhs, ctx)}`.trim(),
    )
    .join(join);
}

function countedBound(step: ParsedStep, exit: ParsedStep | undefined, ctx: Ctx): string | null {
  const conds = conditionsOf(asConditionsInput(exit?.input));
  if (conds.length !== 1) return null;

  const match = String(conds[0]?.lhs ?? '').match(/_dp\('(.+?)'\)/);
  if (!match) return null;
  try {
    const dp = JSON.parse(match[1]!) as { provider?: string; line?: string; path?: unknown };
    const selfIndex =
      dp.provider === 'repeat' &&
      dp.line === step.as &&
      Array.isArray(dp.path) &&
      dp.path.length === 1 &&
      dp.path[0] === 'index';
    if (!selfIndex) return null;
  } catch {
    return null;
  }
  return `${conds[0]?.operand} ${readableExpr(conds[0]?.rhs, ctx)}`.trim();
}

function loopHint(bound: string): string {
  const cut = bound.lastIndexOf('.length');
  if (cut <= 0) return 'No AP, um LOOP_ON_ITEMS sobre uma lista com esse numero de itens.';
  const list = bound.slice(bound.indexOf(' ') + 1, cut).trim();
  return `No AP, um LOOP_ON_ITEMS sobre ${list}.`;
}

function parseStructuredDp(raw: string): { provider?: string; line?: string; path: unknown[] } | null {
  try {
    const dp = JSON.parse(raw) as { provider?: string; line?: string; path?: unknown };
    return { provider: dp.provider, line: dp.line, path: Array.isArray(dp.path) ? dp.path : [] };
  } catch {
    return null;
  }
}

function isRepeatIndexDp(dp: { provider?: string; line?: string; path: unknown[] }, as?: string): boolean {
  return (
    dp.provider === 'repeat' &&
    (as == null || dp.line === as) &&
    dp.path.length === 1 &&
    dp.path[0] === 'index'
  );
}

function listDpKey(dp: { line?: string; path: unknown[] }): string {
  return JSON.stringify({ line: dp.line, path: dp.path });
}

/** `=_dp(lista).length - 1` — bound exclusivo do indice 0-based. */
function lengthMinusOneList(raw: unknown): { json: string; dp: { line?: string; path: unknown[] } } | null {
  const match = String(raw ?? '').match(/_dp\('(.+?)'\)\}?\.length\s*-\s*1\s*$/);
  if (!match) return null;
  const dp = parseStructuredDp(match[1]!);
  return dp ? { json: match[1]!, dp } : null;
}

function standaloneRepeatIndex(raw: unknown, as?: string): boolean {
  const match = String(raw ?? '').match(/^=?(?:#\{)?_dp\('(.+?)'\)\}?\s*$/);
  if (!match) return false;
  const dp = parseStructuredDp(match[1]!);
  return Boolean(dp && isRepeatIndexDp(dp, as));
}

/** Saida `lista.length - 1 != indice`, `indice < lista.length - 1` (ou o inverso). */
function indexedListExit(step: ParsedStep, exit: ParsedStep | undefined): string | null {
  const conds = conditionsOf(asConditionsInput(exit?.input));
  if (conds.length !== 1) return null;
  const cond = conds[0]!;
  const leftList = lengthMinusOneList(cond.lhs);
  const rightList = lengthMinusOneList(cond.rhs);
  const leftIndex = standaloneRepeatIndex(cond.lhs, step.as);
  const rightIndex = standaloneRepeatIndex(cond.rhs, step.as);
  if (cond.operand === 'not_equals_to') {
    if (leftList && rightIndex) return leftList.json;
    if (rightList && leftIndex) return rightList.json;
    return null;
  }
  if (cond.operand === 'less_than' && leftIndex && rightList) return rightList.json;
  if (cond.operand === 'greater_than' && leftList && rightIndex) return leftList.json;
  return null;
}

function stringIndexesList(raw: string, want: string, as?: string): boolean {
  const patterns: Array<{ re: RegExp; list: number; index: number }> = [
    { re: /_dp\('(.+?)'\)\}?\.pluck\('([^']+)'\)\[_dp\('(.+?)'\)\]/g, list: 1, index: 3 },
    { re: /_dp\('(.+?)'\)\[_dp\('(.+?)'\)\]/g, list: 1, index: 2 },
  ];
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(raw))) {
      const listDp = parseStructuredDp(match[pattern.list]!);
      const indexDp = parseStructuredDp(match[pattern.index]!);
      if (listDp && indexDp && listDpKey(listDp) === want && isRepeatIndexDp(indexDp, as)) {
        return true;
      }
    }
  }
  return false;
}

function bodyIndexesList(step: ParsedStep, listJson: string): boolean {
  const list = parseStructuredDp(listJson);
  if (!list) return false;
  const want = listDpKey(list);
  let found = false;
  const visit = (node: unknown): void => {
    if (found) return;
    if (typeof node === 'string') {
      found = stringIndexesList(node, want, step.as);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  for (const child of step.children) {
    if (child.keyword === 'while_condition') continue;
    visit(child);
  }
  return found;
}

function buildIndexedListRepeat(step: ParsedStep, ctx: Ctx, name: string, listJson: string): any {
  const listRaw = `#{_dp('${listJson}')}`;
  const collection = pills(listRaw, ctx);
  let items = resolveFormulas(collection, ctx, name);
  const listDecl = listDeclFromSource(listRaw, ctx);
  if (listDecl && !items.includes('TODO')) {
    const parsed = nextName('var_list');
    const code = codeStep(parsed, `Ler lista "${listDecl.label}"`, { list: items }, listReadCode(), true);
    ctx.pendingCode.push(code);
    items = `{{${parsed}}}`;
  }
  if (!collection || items.includes('TODO')) {
    ctx.todos.push(`LOOP (${name}): definir a lista de itens (items).`);
  }

  ctx.loopScope.push({ collection, item: `${name}['item']` });
  const firstLoopAction = buildChain(step.children, ctx);
  ctx.loopScope.pop();

  return {
    name,
    skip: false,
    type: 'LOOP_ON_ITEMS',
    valid: Boolean(collection) && !items.includes('TODO'),
    settings: { items },
    displayName: step.comment || 'Para cada item',
    firstLoopAction,
    lastUpdatedDate: NOW,
  };
}

/**
 * `repeat` do Workato e loop por CONDICAO de saida; o AP so tem
 * `LOOP_ON_ITEMS`. Quando a saida e `lista.length - 1 != indice` (ou
 * `indice < lista.length - 1`) e o corpo indexa essa lista — direto ou via
 * `.pluck('campo')` — o laco e a propria lista. Lista vazia: o loop nao entra.
 * Os outros casos ficam como step sem piece com o corpo encadeado depois do
 * marcador.
 */
function noteRepeatAdapted(ctx: Ctx, anchor: string, message: string): void {
  pushReviewNote(ctx, 'REPEAT', `Foi adaptada. ${message}`, '', anchor);
}

const LOOKUP_TABLE_OPS = new Set([
  'get_entry',
  'search_entries',
  'add_entry',
  'add_batch_of_entries',
  'update_entry',
  'delete_entry',
  'delete_entries',
  'get_entries',
  'truncate',
]);

function lookupTableIdLabel(raw: unknown): string {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return '(ausente no passo)';
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw).trim();
  return JSON.stringify(raw);
}

/** Uma nota por id de lookup table. A piece Tables continua; o id e as linhas não vêm juntos. */
function noteLookupTable(ctx: Ctx, opKey: string, sourceInput: Record<string, any>, anchor: string): void {
  const collapsed = collapseOpKey(opKey);
  if (!collapsed.startsWith('lookup_table/')) return;
  const op = collapsed.slice('lookup_table/'.length);
  if (!LOOKUP_TABLE_OPS.has(op)) return;
  const id = lookupTableIdLabel(sourceInput.lookup_table_id);
  const token = `Workato lookup_table_id: ${id}.`;
  if (ctx.canvasNotes.some((note) => note.kind === 'LOOKUP' && note.content.includes(token))) return;
  pushReviewNote(
    ctx,
    'LOOKUP',
    [
      token,
      'A Table do iPaaS não herda esse id da Workato e não carrega as linhas nem o volume da tabela original. Recrie ou importe a tabela no iPaaS.',
      `${LOOKUP_IMPORT_NOT_GENERATED} Exporte essa lookup table na Workato.`,
    ].join('\n\n'),
    '',
    anchor,
  );
}

function firstDpJson(raw: unknown): string | null {
  const match = String(raw ?? '').match(/_dp\('(.+?)'\)/);
  return match?.[1] ?? null;
}

function integerBound(raw: unknown): number | null {
  const match = String(raw ?? '').trim().match(/^=?(\d+)$/);
  return match ? Number(match[1]) : null;
}

function loopOverKnownList(step: ParsedStep, ctx: Ctx, name: string, listJson: string, message: string): any {
  const loop = buildIndexedListRepeat(step, ctx, name, listJson);
  noteRepeatAdapted(ctx, name, message);
  return loop;
}

function loopOverTurnCount(
  step: ParsedStep,
  ctx: Ctx,
  name: string,
  bound: string,
  extraOne: boolean,
  message: string,
): any {
  const codeName = nextName('var_turns');
  const code = codeStep(
    codeName,
    'Voltas do repeat',
    { bound: pills(bound.replace(/^=/, ''), ctx), extra: extraOne ? '1' : '0' },
    [
      'export const code = async (inputs) => {',
      '  const raw = Number(inputs.bound);',
      "  const extra = inputs.extra === '1' ? 1 : 0;",
      '  const count = Number.isFinite(raw) ? Math.max(0, Math.floor(raw) + extra) : 0;',
      '  return Array.from({ length: count }, (_, i) => i);',
      '};',
    ].join('\n'),
    true,
  );
  code.nextAction = {
    name,
    skip: false,
    type: 'LOOP_ON_ITEMS',
    valid: true,
    settings: { items: `{{${codeName}}}` },
    displayName: step.comment || 'Para cada volta',
    firstLoopAction: buildChain(step.children, ctx),
    lastUpdatedDate: NOW,
  };
  noteRepeatAdapted(ctx, name, message);
  return code;
}

const TURN_OPERANDS = new Set([
  'less_than',
  'greater_than',
  'not_equals_to',
  'less_than_or_equal',
  'greater_than_or_equal',
]);

function lengthJsonOf(raw: unknown): string | null {
  if (!/\.length\b/.test(String(raw ?? ''))) return null;
  return firstDpJson(raw);
}

function repeatBound(cond: { lhs?: unknown; rhs?: unknown; operand?: string }): { expr: string; extraOne: boolean; literal: number | null } | null {
  if (!TURN_OPERANDS.has(String(cond.operand ?? ''))) return null;
  const rightN = integerBound(cond.rhs);
  const leftN = integerBound(cond.lhs);
  if (rightN != null) {
    return { expr: String(rightN), extraOne: cond.operand === 'less_than', literal: rightN };
  }
  if (leftN != null) {
    return { expr: String(leftN), extraOne: false, literal: leftN };
  }
  if (lengthJsonOf(cond.lhs) || lengthJsonOf(cond.rhs)) return null;
  const expr = firstDpJson(cond.rhs) ? String(cond.rhs ?? '') : firstDpJson(cond.lhs) ? String(cond.lhs ?? '') : '';
  if (!expr) return null;
  return { expr, extraOne: cond.operand === 'less_than' && Boolean(firstDpJson(cond.rhs)), literal: null };
}

/**
 * Repeat while cuja saída descreve uma lista ou um teto de voltas.
 * Paginação, relatório e flag não entram aqui.
 */
function adaptRepeatToLoop(step: ParsedStep, exit: ParsedStep | undefined, ctx: Ctx, name: string): any | null {
  const conds = conditionsOf(asConditionsInput(exit?.input));
  if (!conds.length) return null;
  const size = conds.filter((cond) => repeatSizeClause(cond));
  const cond = size.find((item) => lengthJsonOf(item.lhs) || lengthJsonOf(item.rhs)) ?? size[0];
  if (!cond) return null;
  const extra =
    conds.length > 1
      ? ' As outras condições ficaram de fora do teto: o loop não para no meio; conferir um if dentro da volta.'
      : '';
  const listSide = [cond.lhs, cond.rhs].find((side) => lengthJsonOf(side));
  const listJson = listSide ? lengthJsonOf(listSide) : null;
  if (listJson) {
    const filtered = /\.(where|pluck|flatten)\b/.test(String(listSide));
    const minus = /length\s*-\s*1\s*$/.test(String(listSide));
    return loopOverKnownList(
      step,
      ctx,
      name,
      listJson,
      `O Repeat while comparava um índice com o tamanho da lista. Virou LOOP_ON_ITEMS dessa lista.${extra} ${minus ? 'Lista vazia: o Workato entra uma vez; o loop do iPaaS não entra.' : 'A condição usava .length, não .length - 1: conferir a última volta.'} O índice do iPaaS começa em 1.${filtered ? ' O .length vinha depois de where/pluck; a lista do loop é a lista base.' : ''}`,
    );
  }
  const bound = repeatBound(cond);
  if (!bound) return null;
  const turns = bound.literal != null && bound.extraOne ? bound.literal + 1 : bound.literal;
  return loopOverTurnCount(
    step,
    ctx,
    name,
    bound.expr,
    bound.extraOne,
    turns != null
      ? `O Repeat while tinha teto ${bound.literal}. A lista do LOOP_ON_ITEMS tem ${turns} voltas. O índice do iPaaS começa em 1.${extra}`
      : `O Repeat while tinha teto num campo. A lista do LOOP_ON_ITEMS usa esse valor${bound.extraOne ? ' mais um, porque N voltas se escreve Index < N - 1' : ''}. O índice do iPaaS começa em 1.${extra}`,
  );
}

function repeatSizeClause(cond: { lhs?: unknown; rhs?: unknown; operand?: string }): boolean {
  if (lengthJsonOf(cond.lhs) || lengthJsonOf(cond.rhs)) return true;
  return repeatBound(cond) != null;
}

function repeatBlob(exit: ParsedStep | undefined): string {
  return JSON.stringify(exit?.input ?? '').toLowerCase();
}

function chainRepeatBody(step: ParsedStep, ctx: Ctx, name: string, message: string): any {
  const code = codeStep(
    name,
    'Repeat adaptado',
    {},
    ['export const code = async (inputs) => {', '  return inputs;', '};'].join('\n'),
    true,
  );
  code.nextAction = buildChain(step.children, ctx);
  noteRepeatAdapted(ctx, name, message);
  return code;
}

function buildRepeat(step: ParsedStep, ctx: Ctx): any {
  const name = stepName(step, ctx);
  const exit = step.children.find((child) => child.keyword === 'while_condition');
  const listJson = indexedListExit(step, exit);
  if (listJson && bodyIndexesList(step, listJson)) {
    return buildIndexedListRepeat(step, ctx, name, listJson);
  }
  if (listJson) {
    return loopOverKnownList(
      step,
      ctx,
      name,
      listJson,
      'O Repeat while contava voltas com Index e lista.length - 1, mas o corpo não lia lista[Index]. Virou LOOP_ON_ITEMS dessa lista. Lista vazia: o Workato entra uma vez; o loop do iPaaS não entra.',
    );
  }
  const adapted = adaptRepeatToLoop(step, exit, ctx, name);
  if (adapted) return adapted;
  const blob = repeatBlob(exit);
  const message = /last_cursor|hasnextpage|has_next|pageinfo|next_page/.test(blob)
    ? 'Paginação por cursor. O corpo ficou em seguida e roda uma vez. Para percorrer os registros, acumule as páginas num array e use LOOP_ON_ITEMS. A página seguinte depende da resposta anterior.'
    : /pipereportexport|reportexport/.test(blob)
      ? 'Espera de relatório. O corpo ficou em seguida e roda uma vez. A espera até state = done fica num CODE com teto de tentativas; o LOOP_ON_ITEMS só entra se o arquivo for uma lista.'
      : /blank|is_true|is_false|is_not_true|finished|success/.test(blob)
        ? 'Espera de flag. O corpo ficou em seguida e roda uma vez. A espera fica num CODE com teto; o LOOP_ON_ITEMS só entra se o resultado for uma lista.'
        : 'Não havia lista nem teto de voltas. O corpo ficou encadeado uma vez.';
  return chainRepeatBody(step, ctx, name, message);
}

/** Router no fim de cada bloco monitor. O verificador reconhece pelo displayName. */
const CATCH_ROUTER_LABEL = 'Catch do monitor';

const claimedByCatch = new WeakSet<object>();

/**
 * Passos falíveis deste try. Um monitor de dentro já reivindicou os seus:
 * a falha deles dispara o router interno, não o de fora.
 */
function claimCatchBody(head: any): string[] {
  const names: string[] = [];
  const seen = new Set<any>();
  const walk = (node: any) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (node.type === 'ROUTER' && node.displayName === CATCH_ROUTER_LABEL) {
      walk(node.nextAction);
      return;
    }
    if (isFallibleStep(node) && !claimedByCatch.has(node)) {
      claimedByCatch.add(node);
      if (node.settings?.errorHandlingOptions) {
        node.settings.errorHandlingOptions.continueOnFailure = { value: true };
      }
      names.push(node.name);
    }
    walk(node.nextAction);
    walk(node.firstLoopAction);
    for (const child of node.children ?? []) walk(child);
  };
  walk(head);
  return names;
}

function isStopOnlyCatch(handlers: ParsedStep[]): boolean {
  return handlers.length === 1 && handlers[0]!.keyword === 'stop';
}

function hasActiveCatch(step: ParsedStep): boolean {
  const catchNode = step.children.find((child) => child.keyword === 'catch');
  return (catchNode?.children ?? []).some((handler) => handler.keyword !== 'catch' && handler.skip !== true);
}

function endsWithStopFlow(step: any): boolean {
  let cursor = step;
  const seen = new Set<any>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor.settings?.actionName === 'stopFlow') return true;
    cursor = cursor.nextAction ?? cursor.continueOnFailureBranches?.onSuccess;
  }
  return false;
}

/** O resto do fluxo entra no fim do caminho de sucesso. O ramo de falha já termina em stopFlow. */
function attachRestToSuccessTails(step: any, rest: any, ctx: Ctx): void {
  const tails: any[] = [];
  const seen = new Set<any>();
  const walk = (node: any) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (node.settings?.actionName === 'stopFlow') return;
    if (node.continueOnFailureBranches?.onSuccess) {
      walk(node.continueOnFailureBranches.onSuccess);
      return;
    }
    if (!isFallibleStep(node)) {
      if (node.nextAction) {
        walk(node.nextAction);
        return;
      }
      for (const child of node.children ?? []) {
        if (child && !endsWithStopFlow(child)) walk(child);
      }
      return;
    }
    tails.push(node);
  };
  walk(step);
  if (!tails.length) return;
  const branches = tails[0].continueOnFailureBranches ?? {};
  tails[0].continueOnFailureBranches = { ...branches, onSuccess: rest };
  if (tails.length > 1) {
    ctx.todos.push(
      `STOP: a continuação depois do try também se aplica a ${tails.length - 1} caminho(s) de sucesso — duplicar manualmente.`,
    );
  }
}

function stopFlowStep(ctx: Ctx): any {
  const name = nextName('stop');
  const input = {};
  ctx.piecesUsed.add(FLOW_HELPER_PIECE);
  return {
    name,
    skip: false,
    type: 'PIECE',
    valid: true,
    settings: {
      input,
      pieceName: FLOW_HELPER_PIECE,
      actionName: 'stopFlow',
      pieceVersion: pieceVersion(ctx, FLOW_HELPER_PIECE),
      propertySettings: propertySettings(input),
      errorHandlingOptions: ERR(),
    },
    displayName: 'Parar',
    lastUpdatedDate: NOW,
  };
}

/**
 * Catch que só para o job. Cada Piece/Code do bloco ganha os ramos do step:
 * Success segue a cadeia, Failure chama stopFlow. `nextAction` do passo fica
 * vazio — o motor executa o ramo e depois ainda anda o `nextAction`.
 * Router e loop não têm ramo; os passos de dentro sim. Passo já reivindicado
 * por outro catch (router no fim, ou este mesmo tratamento) fica como está.
 */
function rewireStopOnFailure(step: any, ctx: Ctx): any {
  if (!step) return step;
  if (step.settings?.actionName === 'stopFlow') return step;
  if (step.type === 'ROUTER' && step.displayName === CATCH_ROUTER_LABEL) {
    step.nextAction = rewireStopOnFailure(step.nextAction, ctx);
    return step;
  }
  if (step.continueOnFailureBranches || claimedByCatch.has(step)) {
    step.nextAction = rewireStopOnFailure(step.nextAction, ctx);
    if (step.continueOnFailureBranches?.onSuccess) {
      step.continueOnFailureBranches.onSuccess = rewireStopOnFailure(step.continueOnFailureBranches.onSuccess, ctx);
    }
    return step;
  }
  if (step.firstLoopAction) step.firstLoopAction = rewireStopOnFailure(step.firstLoopAction, ctx);
  if (Array.isArray(step.children)) {
    step.children = step.children.map((child: any) => rewireStopOnFailure(child, ctx));
  }
  const rest = step.nextAction ? rewireStopOnFailure(step.nextAction, ctx) : undefined;
  if (!isFallibleStep(step)) {
    step.nextAction = rest;
    return step;
  }
  step.nextAction = undefined;
  if (step.settings?.errorHandlingOptions) {
    step.settings.errorHandlingOptions.continueOnFailure = { value: true };
  }
  const failure = stopFlowStep(ctx);
  step.continueOnFailureBranches = rest ? { onSuccess: rest, onFailure: failure } : { onFailure: failure };
  claimedByCatch.add(step);
  return step;
}

/** Primeira mensagem de erro entre os passos deste monitor. */
function catchMessageStep(owners: string[]): any {
  const name = nextName('catch_msg');
  const input: Record<string, string> = {};
  owners.forEach((owner, index) => {
    input[`e${index}`] = `{{${owner}['error']['message']}}`;
  });
  const reads = owners.map((_, index) => `inputs.e${index}`).join(', ');
  const code = [
    'export const code = async (inputs) => {',
    `  const messages = [${reads}];`,
    "  const message = messages.find((item) => item !== undefined && item !== null && String(item) !== '') ?? '';",
    '  return { message };',
    '};',
  ].join('\n');
  return codeStep(name, 'Mensagem do catch', input, code, true);
}

function bindCatchMessage(head: any, messagePill: string): any {
  const raw = JSON.stringify(head).split(CATCH_ERROR_TOKEN).join(messagePill);
  return JSON.parse(raw);
}

/** Um router para o catch. As ações, e o stop quando existe, aparecem uma vez. */
function sharedCatchRouter(owners: string[], handler: any): any {
  const message = catchMessageStep(owners);
  const branch = appendToChain(message, bindCatchMessage(handler, `{{${message.name}['message']}}`));
  return {
    name: nextName('catch'),
    skip: false,
    type: 'ROUTER',
    valid: true,
    settings: {
      branches: [
        {
          branchName: 'Cenario de erro',
          branchType: 'CONDITION',
          conditions: owners.map((owner) => [
            { operator: 'EXISTS', firstValue: `{{${owner}['error']['message']}}` },
          ]),
        },
        { branchName: 'Seguiu', branchType: 'FALLBACK' },
      ],
      executionType: 'EXECUTE_FIRST_MATCH',
    },
    children: [branch, null],
    displayName: CATCH_ROUTER_LABEL,
    lastUpdatedDate: NOW,
  };
}

/** Passos deste monitor. Um catch de dentro já ficou com a falha dele. */
function collectMonitorOwners(step: any, names: string[] = [], seen = new Set<any>()): string[] {
  if (!step || seen.has(step)) return names;
  seen.add(step);
  if (step.settings?.actionName === 'stopFlow') return names;
  if (step.displayName === CATCH_ROUTER_LABEL) return names;
  if (step.continueOnFailureBranches || claimedByCatch.has(step)) {
    collectMonitorOwners(step.continueOnFailureBranches?.onSuccess, names, seen);
    return names;
  }
  if (step.firstLoopAction) collectMonitorOwners(step.firstLoopAction, names, seen);
  for (const child of step.children ?? []) collectMonitorOwners(child, names, seen);
  if (isFallibleStep(step) && step.name) names.push(step.name);
  collectMonitorOwners(step.nextAction, names, seen);
  return names;
}

/**
 * Catch com ações. Sucesso segue o bloco. A falha não leva os passos seguintes.
 * O router do cenário de erro fica uma vez, no nextAction do primeiro passo:
 * o motor anda esse nextAction depois do ramo, então qualquer falha da cadeia
 * volta nele. Passo já reivindicado por um monitor de dentro fica como está.
 */
function rewireOpenCatch(step: any, ctx: Ctx): any {
  if (!step) return step;
  if (step.settings?.actionName === 'stopFlow' || step.displayName === CATCH_ROUTER_LABEL) return step;
  if (step.continueOnFailureBranches || claimedByCatch.has(step)) {
    if (step.continueOnFailureBranches?.onSuccess) {
      step.continueOnFailureBranches.onSuccess = rewireOpenCatch(step.continueOnFailureBranches.onSuccess, ctx);
    }
    return step;
  }
  if (step.firstLoopAction) step.firstLoopAction = rewireOpenCatch(step.firstLoopAction, ctx);
  if (Array.isArray(step.children)) {
    step.children = step.children.map((child: any) => rewireOpenCatch(child, ctx));
  }
  const rest = step.nextAction ? rewireOpenCatch(step.nextAction, ctx) : undefined;
  if (!isFallibleStep(step)) {
    step.nextAction = rest;
    return step;
  }
  step.nextAction = undefined;
  if (step.settings?.errorHandlingOptions) {
    step.settings.errorHandlingOptions.continueOnFailure = { value: true };
  }
  if (rest) step.continueOnFailureBranches = { onSuccess: rest };
  claimedByCatch.add(step);
  return step;
}

function buildTry(step: ParsedStep, ctx: Ctx): any | null {
  const catchNode = step.children.find((c) => c.keyword === 'catch');
  const handlers = (catchNode?.children ?? []).filter((c) => c.keyword !== 'catch');
  const activeHandlers = handlers.filter((handler) => handler.skip !== true);

  const first = buildChain(
    step.children.filter((c) => c.keyword !== 'catch'),
    ctx,
  );

  if (isStopOnlyCatch(activeHandlers)) {
    return rewireStopOnFailure(first, ctx) ?? null;
  }

  if (!activeHandlers.length) {
    claimCatchBody(first);
    return first ?? null;
  }

  const handlerHead = buildChain(activeHandlers, ctx);
  if (!handlerHead) return first ?? null;
  notePendingJobContext(ctx, lastStepName(first));

  const owners = collectMonitorOwners(first);
  const router = sharedCatchRouter(owners, handlerHead);
  const head = rewireOpenCatch(first, ctx);
  attachSharedRouter(head, router);
  return head ?? null;
}

/** O router do catch fica no nextAction do primeiro passo falível deste monitor. */
function attachSharedRouter(step: any, router: any, seen = new Set<any>()): boolean {
  if (!step || seen.has(step) || step === router || step.displayName === CATCH_ROUTER_LABEL) return false;
  seen.add(step);
  const ownedByInner =
    step.continueOnFailureBranches?.onFailure || step.nextAction?.displayName === CATCH_ROUTER_LABEL;
  if (ownedByInner) {
    return attachSharedRouter(step.continueOnFailureBranches?.onSuccess, router, seen);
  }
  if (isFallibleStep(step)) {
    step.nextAction = router;
    return true;
  }
  if (attachSharedRouter(step.nextAction, router, seen)) return true;
  if (attachSharedRouter(step.continueOnFailureBranches?.onSuccess, router, seen)) return true;
  for (const child of step.children ?? []) {
    if (attachSharedRouter(child, router, seen)) return true;
  }
  return false;
}

function describeFilter(filter: WorkatoConditionsInput | undefined): string {
  return (
    conditionsOf(filter)
      .map((item) => `${item?.lhs} ${item?.operand} ${item?.rhs}`)
      .join(' / ') || 'ver receita'
  );
}

/**
 * O `filter` do trigger Workato decide se o job roda. Nenhum piece trigger do
 * AP tem filtro proprio. A traducao fiel e envolver o corpo num ROUTER.
 */
function gateOnTriggerFilter(root: ParsedStep, nextAction: any | undefined, ctx: Ctx): any | undefined {
  if (!conditionsOf(root.filter).length) return nextAction;

  const built = buildConditionGroups(root.filter, ctx);
  const name = nextName('trigger_filter');
  const groups = resolveFormulas(built.groups, ctx, name) as any[][];
  const review = built.review || hasTodoMarker(groups);
  ctx.todos.push(
    `TRIGGER FILTER (${name}): a receita só dispara quando ${describeFilter(root.filter)} — ` +
      'virou router em volta do flow. Se a piece do trigger tiver prop equivalente, preferir a prop.',
  );

  const filter = {
    name,
    skip: false,
    type: 'ROUTER',
    valid: !review,
    settings: {
      branches: [
        { branchName: 'Filtro do gatilho', branchType: 'CONDITION', conditions: groups },
        { branchName: 'Senao', branchType: 'FALLBACK' },
      ],
      executionType: 'EXECUTE_FIRST_MATCH',
    },
    children: [nextAction ?? null, null],
    displayName: 'Filtro do gatilho (Workato)',
    lastUpdatedDate: NOW,
  };
  // O CODE das formulas do filtro tem de rodar antes do router, logo depois do
  // gatilho: nao ha onde encaixa-lo dentro do proprio router.
  return prependPendingCode(filter, ctx);
}

function buildTrigger(root: ParsedStep, ctx: Ctx): any {
  noteWorkatoDataTable(ctx, root, 'trigger');
  const opKey = root.opKey ?? `${root.provider}/${root.name}`;
  const entry = lookupMap(ctx.merged, opKey);
  if (String(root.provider ?? '').includes('recipe_function') && root.name === 'execute') {
    ctx.subflowResultLabels = resultLabelsFromSchema(root.input?.result_schema_json);
  }
  let nextAction = gateOnTriggerFilter(root, buildChain(root.children, ctx), ctx);

  if (entry?.target?.kind === 'trigger') {
    const t = entry.target;
    ctx.piecesUsed.add(t.piece);
    let input = convInput(
      resolveZeroPhaseInput(root.input ?? {}, root.phasePickLabel, ctx.phasesByPipe),
      entry,
      ctx,
    );
    if (t.piece === SUBFLOW_PIECE && t.name === 'callableFlow') {
      input = shapeCallableFlow(root.input ?? {});
    }
    input = fillKnownProps(t, input, root.input ?? {});
    if (ctx.jobContextHits.created) nextAction = jobNowStep(nextAction);
    if (opKey === 'clock/scheduled_event' && t.name === 'cron_expression') {
      const cron = workatoScheduleToCron(root.input);
      if (cron) input.cronExpression = cron;
      const weeks = biweeklyWeeks(root.input);
      if (weeks) {
        const timezone = String(root.input?.timezone ?? input.timezone ?? 'America/Sao_Paulo');
        input.timezone = timezone;
        const anchor = biweeklyAnchor(root.input?.days_of_week);
        nextAction = biweeklyGate(nextAction, weeks, anchor, timezone);
        pushReviewNote(
          ctx,
          'SCHEDULE',
          `A agenda Workato é a cada ${weeks} semanas. O gatilho dispara toda semana (${cron ?? 'cron semanal'}) em ${timezone}. O passo agenda_semana só deixa seguir na semana certa, contada a partir de ${anchor}.`,
          '',
          'agenda_semana',
        );
      } else {
        if (!input.timezone) input.timezone = 'UTC';
        const note = scheduleCronTodo(root.input, cron ?? '');
        if (note) ctx.todos.push(note);
      }
    }
    const missing = waivedMissing(t, input, root.input ?? {}, missingRequiredProps(ctx, t, input));
    if (missing.length) {
      ctx.todos.push(`PROPS (trigger): preencher obrigatorias ausentes: ${missing.join(', ')}.`);
    }
    return {
      name: 'trigger',
      valid: missing.length === 0,
      displayName: root.name || 'Gatilho',
      nextAction,
      type: 'PIECE_TRIGGER',
      settings: {
        propertySettings: settingsFor(t.piece, t.name, input),
        pieceName: t.piece,
        pieceVersion: pieceVersion(ctx, t.piece),
        triggerName: t.name,
        input,
      },
      lastUpdatedDate: NOW,
    };
  }
  ctx.todos.push(`TRIGGER nao mapeado: "${opKey}" -> definir mapa.`);
  return {
    name: 'trigger',
    valid: false,
    displayName: root.name || 'Gatilho',
    nextAction,
    type: 'PIECE_TRIGGER',
    settings: {
      propertySettings: {},
      pieceName: TODO_PIECE,
      pieceVersion: '~latest',
      triggerName: TODO_PIECE,
      input: root.input,
    },
    lastUpdatedDate: NOW,
  };
}

function collectLoopedListLines(step: ParsedStep, out: Set<string>): void {
  if (step.keyword === 'foreach' && step.source) {
    const line = firstPill(step.source)?.line;
    if (line) out.add(String(line));
  }
  for (const child of step.children) collectLoopedListLines(child, out);
}

export function buildFlow(recipe: ParsedRecipe, merged: Record<string, MapEntry>, kb: Kb): BuildResult {
  nameSeq = 0;
  NOW = new Date().toISOString();
  const ctx: Ctx = {
    merged,
    kb: new Map(kb.pieces.map((p) => [p.name, p])),
    asToName: new Map(),
    skippedAs: new Set(),
    loopedListLines: new Set(),
    loopScope: [],
    piecesUsed: new Set(),
    todos: [],
    canvasNotes: [],
    recipeName: recipe.name,
    recipeId: recipe.workatoId,
    jobContextHits: emptyHits(),
    jobContextNoted: emptyHits(),
    counter: { n: 1 },
    pendingCode: [],
    vars: indexVariables(recipe.root),
    subflowResultLabels: new Map(),
    phasesByPipe: recipe.phasesByPipe ?? [],
    connectionsByProvider: recipe.connectionsByProvider ?? {},
    projectVariables: new Map(),
    notedDataTableIds: new Set(),
  };
  collectLoopedListLines(recipe.root, ctx.loopedListLines);
  assignNames(recipe.root, ctx, true);
  const trigger = buildTrigger(recipe.root, ctx);
  notePendingJobContext(ctx, lastStepName(trigger));
  noteProjectVariables(ctx, lastStepName(trigger));

  const flow = {
    name: recipe.name,
    type: 'SHARED',
    summary: '',
    description: recipe.description ?? '',
    tags: [],
    blogUrl: '',
    metadata: {},
    author: 'workato-migration',
    categories: [],
    pieces: [...ctx.piecesUsed].sort(),
    flows: [
      {
        displayName: recipe.name,
        trigger,
        valid: ctx.todos.length === 0,
        schemaVersion: '20',
        notes: placeCanvasNotes(trigger, ctx.canvasNotes),
      },
    ],
    status: 'PUBLISHED',
  };
  return { flow: bracketizePills(flow), todos: [...new Set(ctx.todos)] };
}
