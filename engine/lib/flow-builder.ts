// Constroi um export Activepieces a partir da receita Workato parseada.
// Schema calibrado contra um flow real exportado (schemaVersion "20").
// Marca com TODO tudo que exige revisao (Ruby, formulas complexas, ops nao mapeadas).

import type {
  Kb,
  MapEntry,
  MapTarget,
  ParsedStep,
  ParsedRecipe,
  SlimPiece,
  WorkatoCondition,
  WorkatoConditionsInput,
} from './types.ts';
import { collapseOpKey, lookupMap } from './collapse.ts';
import { OMIE_APP_KEY, OMIE_APP_SECRET, omieActionName, omieHttpInput } from './omie-http.ts';
import {
  dynamicPropertySettings,
  resultLabelsFromSchema,
  shapeCallFlow,
  shapeCallableFlow,
  shapeReturnResponse,
} from './subflow.ts';
import { resolveRubySleep, resolveWaitUntilTime } from './delay.ts';
import {
  convertPills,
  detectRubyMethods,
  isRubyExpression,
  parseIncludeFormula,
  peelTrailingCaseMethod,
  stepBindingName,
  wrapApCase,
  type JobContextHits,
  type StepBinding,
  type StepNameMap,
} from './datapills.ts';
import {
  compileRubyExpression,
  CURRENCY_NOTE,
  MULTIPLY_NOTE,
  newBindingRegistry,
  renderHelpers,
  type BindingRegistry,
} from './ruby-expr.ts';
import { scheduleCronTodo, workatoScheduleToCron } from './schedule-cron.ts';
import {
  indexVariables,
  parseVarName,
  readsOf,
  variableOp,
  SOURCE_KEY,
  type VarDecl,
  type VarIndex,
} from './variables.ts';
import {
  describeStrategy,
  storeGetRef,
  variableCode,
  writtenFields,
  FIELDS_KEY,
  PREV_KEY,
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
  /**
   * Foreach abertos no ponto atual da construcao, de fora para dentro. Pills de
   * "item atual" resolvem contra o mais interno que itera aquela colecao.
   */
  loopScope: LoopScope[];
  piecesUsed: Set<string>;
  todos: string[];
  canvasNotes: PendingCanvasNote[];
  /** Nome e id da receita, para pills `job_context` que não apontam para um passo. */
  recipeName: string;
  recipeId?: string;
  jobContextHits: JobContextHits;
  jobContextNoted: JobContextHits;
  catchMessageHits: { n: number };
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
}

interface PendingCanvasNote {
  id: string;
  kind: 'CATCH' | 'STOP' | 'JOB' | 'SECRET' | 'FORMULA' | 'SUBFLOW';
  content: string;
  anchorStepName?: string;
}

/** Sentinel for piece/action/trigger names the transpiler could not resolve. */
const TODO_PIECE = 'TODO';

const PIPEFY_PIECE = '@activepieces/piece-pipefy';
const PIPEFY_PAYLOAD_ROOT = 'data';
const PIPEFY_GET_CARD_PAYLOAD_ROOT = 'data.card';

function pipefyOutputRoot(targetName: string | undefined): string {
  return targetName === 'getCardById' ? PIPEFY_GET_CARD_PAYLOAD_ROOT : PIPEFY_PAYLOAD_ROOT;
}

function bindAs(ctx: Ctx, as: string | undefined, name: string, step: ParsedStep): void {
  if (!as) return;
  const opKey = step.opKey ?? (step.provider && step.name ? `${step.provider}/${step.name}` : undefined);
  const target = opKey ? lookupMap(ctx.merged, opKey)?.target : undefined;
  ctx.asToName.set(
    as,
    target?.piece === PIPEFY_PIECE ? { name, outputRoot: pipefyOutputRoot(target.name) } : name,
  );
}

/**
 * `actionName` do marcador de `repeat`/`while`. Compartilha o `pieceName: TODO`
 * (o step tem de ficar invalido), mas se distingue de uma operacao que faltou
 * mapear: aqui a limitacao e da plataforma, o AP so itera colecao.
 */
const REPEAT_ACTION = 'REPEAT_UNSUPPORTED';

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
    catchMessageHits: ctx.catchMessageHits,
  });
}

const ERR = () => ({
  retryOnFailure: { value: false },
  continueOnFailure: { value: false },
});

function isFallibleStep(step: any): boolean {
  return step?.type === 'PIECE' || step?.type === 'CODE';
}

// lastUpdatedDate e obrigatorio (z.string()) em trigger e em cada step (schema AP).
let NOW = '1970-01-01T00:00:00.000Z';

function pieceVersion(ctx: Ctx, pieceName: string): string {
  return ctx.kb.get(pieceName)?.version ?? '~latest';
}

/** propertySettings: cada input vira {type:'MANUAL'} (como no export real). */
function propertySettings(input: Record<string, any>): Record<string, any> {
  const ps: Record<string, any> = {};
  for (const k of Object.keys(input)) ps[k] = { type: 'MANUAL' };
  return ps;
}

const SUBFLOW_PIECE = '@activepieces/piece-subflows';

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
  const hasMap = Object.keys(map).length > 0 || Object.keys(fixed).length > 0;
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
    if (!built) continue;
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
 * formula nao traduzida). Sem isso o step sairia `valid: true` carregando um
 * template que nao resolve em runtime.
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
 * Acao solta sai como step com `skip: true`. Bloco de controle desativado sai
 * inteiro: `skip` no AP nao esta definido para ROUTER/LOOP.
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
    return null;
  }

  if (step.keyword === 'stop') return null;

  const built = buildAction(step, ctx);
  if (built) built.skip = true;
  return built;
}

/** Step `store/get`, encadeado ANTES do passo que le a variavel. */
function injectStoreGet(decl: VarDecl, ctx: Ctx): string {
  const name = nextName('var_get');
  const input = { key: decl.storeKey, store_scope: STORE_SCOPE };
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
    displayName: `Ler variavel "${decl.label}"`,
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
function variableOverlay(step: ParsedStep, ctx: Ctx): Map<string, string> | null {
  if (!ctx.vars.decls.size) return null;
  const overlay = new Map<string, string>(step.varSnapshot ?? []);

  const reads = readsOf(step);
  // As condicoes de `elsif` sao avaliadas no proprio router, mas moram nos
  // filhos: sem varrer aqui, a leitura delas ficaria sem `get`.
  if (step.keyword === 'if') {
    for (const child of step.children) {
      if (child.keyword !== 'elsif' && child.keyword !== 'elseif') continue;
      for (const as of readsOf(child)) reads.add(as);
    }
  }
  // Escrita precisa do valor anterior para o merge.
  const written = step.skip ? undefined : writtenVariable(step, ctx);
  if (written && variableOp(step) !== 'declare') reads.add(written.as);

  for (const as of reads) {
    const decl = ctx.vars.decls.get(as);
    if (decl?.strategy !== 'store') continue;
    overlay.set(as, storeGetRef(injectStoreGet(decl, ctx)));
  }
  return overlay.size ? overlay : null;
}

function withOverlay<T>(ctx: Ctx, overlay: Map<string, string> | null, build: () => T): T {
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
      if (String(step.input?.stop_with_error) === 'true') {
        ctx.todos.push('STOP: stop_with_error — AP nao tem equivalente; revisar (erro explicito).');
        pushReviewNote(
          ctx,
          'STOP',
          'Workato stop_with_error — o AP nao tem equivalente. Esta nota marca o ponto onde a receita parava com erro explicito. Recriar o tratamento manualmente.',
        );
      }
      return null;
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
function buildCodeStub(opKey: string, ruby: string): string {
  if (ruby.trim()) {
    const commented = ruby.split('\n').map((l) => ` * ${l}`).join('\n');
    return [
      '/**',
      ` * AP-MIGRATION-TODO: traduzir o Ruby (Workato "${opKey}") para JavaScript.`,
      ' * Formato Activepieces: use `inputs.<campo>` (chaves de settings.input) e RETORNE o resultado final.',
      ' *',
      ' * --- RUBY ORIGINAL (Workato) ---',
      commented,
      ' * --- FIM RUBY ---',
      ' */',
      'export const code = async (inputs) => {',
      '  // TODO(LLM): implementar o equivalente do Ruby acima.',
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
    for (const [k, v] of Object.entries(value)) out[k] = replaceResidualRuby(v, harvest, (src as any)[k]);
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
  if (!harvest.fields.length) return replaced;

  ctx.pendingCode.push(formulaCodeStep(harvest));
  ctx.todos.push(
    `FORMULA (${owner}): ${harvest.fields.length} formula(s) Workato viraram JS no step ` +
      `${harvest.name()} — conferir a traducao.`,
  );
  for (const note of [...new Set(harvest.approximations)]) {
    ctx.todos.push(`FORMULA (${harvest.name()}): ${note}.`);
    if (note === MULTIPLY_NOTE || note === CURRENCY_NOTE) {
      pushReviewNote(
        ctx,
        'FORMULA',
        `Passo \`${owner}\`, step \`${harvest.name()}\`.\n\n${note}`,
        harvest.name(),
        harvest.name(),
      );
    }
  }
  return replaced;
}

function codeStep(name: string, displayName: string, input: Record<string, any>, code: string): any {
  return {
    name,
    skip: false,
    type: 'CODE',
    valid: false,
    settings: {
      input,
      sourceCode: { code, packageJson: '{}' },
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
  return { name: 0, id: 0, link: 0 };
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

function describeLostHandlers(handlers: ParsedStep[]): string {
  return handlers.map((c) => c.comment || c.opKey || c.keyword).join(', ');
}

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
  kind: 'CATCH' | 'STOP' | 'JOB' | 'SECRET' | 'FORMULA' | 'SUBFLOW',
  message: string,
  lost = '',
  anchorStepName?: string,
): void {
  const label =
    kind === 'CATCH'
      ? REVIEW_CATCH_LABEL
      : kind === 'STOP'
        ? REVIEW_STOP_LABEL
        : kind === 'SECRET'
          ? REVIEW_SECRET_LABEL
          : kind === 'FORMULA'
            ? REVIEW_FORMULA_LABEL
            : kind === 'SUBFLOW'
              ? REVIEW_SUBFLOW_LABEL
              : REVIEW_JOB_CONTEXT_LABEL;
  const prefix =
    kind === 'CATCH'
      ? 'review_catch'
      : kind === 'STOP'
        ? 'review_stop'
        : kind === 'SECRET'
          ? 'review_secret'
          : kind === 'FORMULA'
            ? 'review_formula'
            : kind === 'SUBFLOW'
              ? 'review_subflow'
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

/**
 * Materializa uma operacao `workato_variable/*`.
 *
 * `static`/`linear`: um step CODE cujo OUTPUT e o valor da variavel — as pills
 * de leitura ja foram reapontadas para ele pelo overlay.
 *
 * `store`: o mesmo CODE calcula o novo valor e um `store/put` o persiste, para
 * que a proxima iteracao do loop (ou o passo depois do ramo) consiga le-lo.
 */
function buildVariableStep(step: ParsedStep, ctx: Ctx): any | null {
  const op = variableOp(step);
  const decl = writtenVariable(step, ctx);
  // Escrita sem declare correspondente na receita: sem saber a forma do valor,
  // o caminho antigo (stub CODE + TODO) continua sendo a resposta honesta.
  if (!op || !decl) return null;

  const name = stepName(step, ctx);
  const kindLabel = decl.kind === 'list' ? 'Lista' : 'Variavel';
  const display = step.comment || `${kindLabel} "${decl.label}" (${op})`;

  const fields = convInput(writtenFields(step, op), undefined, ctx);
  const body = variableCode(decl, op, step, Object.keys(fields).length > 0);

  const input: Record<string, any> = {};
  if (body.needsPrev) {
    const previous = stepBindingName(ctx.asToName.get(decl.as));
    // Sem escritor anterior (update antes do declare, receita inconsistente) o
    // codigo cai no objeto vazio — melhor que referenciar um step inexistente.
    if (previous) input[PREV_KEY] = `{{${previous}}}`;
  }
  if (Object.keys(fields).length) input[FIELDS_KEY] = fields;
  if (body.needsSource) {
    input[SOURCE_INPUT_KEY] = deepConvert(step.input?.list_items?.[SOURCE_KEY], ctx);
  }

  const resolved = resolveFormulas(input, ctx, name);

  // Ruby que o compilador de formulas nao cobriu chega ate aqui como texto. Sem
  // marcar, o step sairia `valid: true` carregando codigo que nao roda.
  const ruby: string[] = [];
  collectResidualRubyMethods(resolved, '', ruby);
  if (ruby.length) {
    ctx.todos.push(
      `FORMULA (${name}): a escrita de "${decl.label}" carrega formula Workato sem equivalente ` +
        `em template AP: ${ruby.join(', ')}. Traduzir para JS dentro do step.`,
    );
  }

  const skip = step.skip === true;
  const code = {
    name,
    skip,
    type: 'CODE',
    valid: !ruby.length && !hasTodoMarker(resolved),
    settings: {
      input: resolved,
      sourceCode: { code: body.code, packageJson: '{}' },
      errorHandlingOptions: ERR(),
    },
    displayName: display,
    lastUpdatedDate: NOW,
  } as any;

  if (decl.strategy !== 'store') return code;

  const putInput = { key: decl.storeKey, value: `{{${name}}}`, store_scope: STORE_SCOPE };
  ctx.piecesUsed.add(STORE_PIECE);
  code.nextAction = {
    name: nextName('var_put'),
    skip,
    type: 'PIECE',
    valid: true,
    settings: {
      input: putInput,
      pieceName: STORE_PIECE,
      actionName: 'put',
      pieceVersion: pieceVersion(ctx, STORE_PIECE),
      propertySettings: propertySettings(putInput),
      errorHandlingOptions: ERR(),
    },
    displayName: `Gravar ${kindLabel.toLowerCase()} "${decl.label}"`,
    lastUpdatedDate: NOW,
  };
  return code;
}

const HTTP_PIECE = '@activepieces/piece-http';

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

function buildAction(step: ParsedStep, ctx: Ctx): any {
  const variable = buildVariableStep(step, ctx);
  if (variable) return variable;

  const opKey = step.opKey ?? `${step.provider}/${step.name}`;
  let entry = lookupMap(ctx.merged, opKey);
  let sourceInput = step.input ?? {};
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
  const display =
    step.comment ||
    (collapseOpKey(opKey) === 'file_connector/read_file' ? 'Get file from URL' : step.name) ||
    opKey;

  // manual (Ruby) / builtin (code|loop|...) -> step CODE
  if (!rubySleep && (entry?.manual || entry?.builtin || opKey.endsWith('/invoke_custom_ruby_code'))) {
    const isRuby = opKey.endsWith('/invoke_custom_ruby_code');
    const ruby = isRuby ? String(step.input?.code ?? '') : '';
    // para custom ruby, os inputs reais estao em code_input.data
    const rawInput = isRuby ? (step.input?.code_input?.data ?? {}) : sourceInput;
    const kind = entry?.builtin === 'loop' ? 'acumulador/loop' : isRuby ? 'Ruby' : 'logica';
    ctx.todos.push(`CODE (${name}): traduzir "${opKey}" (${kind}) para JS. Ruby original embutido no step.`);
    const codeInput = resolveFormulas(convInput(rawInput, undefined, ctx), ctx, name);
    const source = isRuby ? ruby : String(step.input?.code ?? '');
    const lifted = liftCodeSecrets(codeInput, source, ctx, name);
    return codeStep(name, display, lifted.input, buildCodeStub(opKey, isRuby ? lifted.source : ruby));
  }

  if (!entry || !entry.target) {
    // Passo desligado que nao tem piece: o cartao vazio do bloco de erro
    // ("Select an app and action", skip: true). Nao vira TODO no flow.
    if (step.skip) return null;
    ctx.todos.push(`NAO MAPEADA (${name}): "${opKey}" -> definir mapa (add-map).`);
    return todoPieceStep(name, display, sourceInput);
  }

  const t = entry.target;
  ctx.piecesUsed.add(t.piece);
  let input = resolveFormulas(convInput(sourceInput, entry, ctx), ctx, name, sourceInput);
  const omie = fillOmieHttp(opKey, t, input, sourceInput, ctx, name);
  if (omie) input = omie;
  if (t.piece === SUBFLOW_PIECE) {
    const shaped = applySubflowAction(opKey, t.name, sourceInput, ctx, name);
    if (shaped) input = shaped;
  }
  if (slackSendWantsFlowLink(t, sourceInput)) input.mentionOriginFlow = true;
  const missing = missingRequiredProps(ctx, t, input);
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
  return {
    name,
    skip: false,
    type: 'PIECE',
    valid: missing.length === 0 && unresolved.length === 0,
    settings: {
      input,
      pieceName: t.piece,
      actionName: t.name,
      pieceVersion: pieceVersion(ctx, t.piece),
      propertySettings: settingsFor(t.piece, t.name, input),
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
    ...branches.map((branch) => stopsExecution(branch.children.at(-1))),
    stopsExecution(elseChildren.at(-1)),
  ];
}

/** `stop` desativado nao encerra nada: o ramo segue aberto. */
function stopsExecution(step: ParsedStep | undefined): boolean {
  return step?.keyword === 'stop' && !step.skip;
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

function buildLoop(step: ParsedStep, ctx: Ctx): any {
  const name = step.apName || nextName('loop');
  // A colecao e avaliada no escopo de FORA: o source de um loop aninhado
  // referencia o item do loop externo, nao o proprio.
  const items = step.source
    ? resolveFormulas(pills(step.source, ctx), ctx, name)
    : '{{TODO_lista}}';
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

/**
 * `repeat` do Workato e loop por CONDICAO de saida; o AP so tem
 * `LOOP_ON_ITEMS`. Nao ha traducao fiel, entao o no fica como step sem piece:
 * isso mantem o flow `valid: false`. O corpo vem encadeado depois do marcador.
 */
function buildRepeat(step: ParsedStep, ctx: Ctx): any {
  const name = stepName(step, ctx);
  const exit = step.children.find((child) => child.keyword === 'while_condition');
  const bound = countedBound(step, exit, ctx);

  ctx.todos.push(
    bound
      ? `REPEAT (${name}): laco CONTADO — roda enquanto o indice ${bound}. ${loopHint(bound)} ` +
          'Corpo encadeado abaixo; conferir a base do indice.'
      : `REPEAT (${name}): laco por CONDICAO de saida (${describeReadable(asConditionsInput(exit?.input), ctx)}) — ` +
          'o AP so itera colecao, nao ha equivalente. Corpo encadeado abaixo; precisa reestruturar.',
  );

  return {
    name,
    skip: false,
    type: 'PIECE',
    valid: false,
    settings: {
      input: step.input,
      pieceName: TODO_PIECE,
      actionName: REPEAT_ACTION,
      pieceVersion: '~latest',
      propertySettings: {},
      errorHandlingOptions: ERR(),
    },
    displayName: step.comment || 'Repetir enquanto (rever)',
    nextAction: buildChain(step.children, ctx),
    lastUpdatedDate: NOW,
  };
}

/**
 * O AP v20 nao tem try/catch. O corpo do try segue com `continueOnFailure`.
 * O corpo do catch vira `onFailureAction` de cada passo falivel do try (o
 * iPaaS executa esse ramo quando o passo falha). Catch vazio nao gera ramo.
 */
function cloneCatch(head: any, copy: number): any {
  const clone = structuredClone(head);
  const names: string[] = [];
  const collect = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string' && node.type) names.push(node.name);
    collect(node.nextAction);
    collect(node.firstLoopAction);
    collect(node.onFailureAction);
    for (const child of node.children ?? []) collect(child);
  };
  collect(clone);
  let raw = JSON.stringify(clone);
  for (const from of [...new Set(names)].sort((a, b) => b.length - a.length)) {
    const to = `${from}_err${copy}`;
    raw = raw.split(`"${from}"`).join(`"${to}"`).split(`{{${from}`).join(`{{${to}`);
  }
  return JSON.parse(raw);
}

function visitBuilt(step: any, visit: (node: any) => void): void {
  const seen = new Set<any>();
  const walk = (node: any) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    visit(node);
    walk(node.nextAction);
    walk(node.firstLoopAction);
    for (const child of node.children ?? []) walk(child);
  };
  walk(step);
}

function buildTry(step: ParsedStep, ctx: Ctx): any | null {
  const catchNode = step.children.find((c) => c.keyword === 'catch');
  const handlers = (catchNode?.children ?? []).filter((c) => c.keyword !== 'catch');

  const first = buildChain(
    step.children.filter((c) => c.keyword !== 'catch'),
    ctx,
  );
  visitBuilt(first, (s) => {
    if (isFallibleStep(s)) s.settings.errorHandlingOptions.continueOnFailure = { value: true };
  });

  if (!handlers.length) return first ?? null;

  const anchor = lastStepName(first);
  const handlerHead = buildChain(handlers, ctx);
  if (handlerHead) {
    let copy = 0;
    visitBuilt(first, (s) => {
      if (!isFallibleStep(s) || s.onFailureAction) return;
      s.onFailureAction = cloneCatch(handlerHead, ++copy);
    });
  }

  if (handlerHead || handlers.some((handler) => handler.keyword === 'stop')) {
    const lost = describeLostHandlers(handlers);
    const where = step.comment || `try passo ${step.number ?? '?'}`;
    ctx.todos.push(
      `CATCH (${where}): o AP nao tem try/catch. ` +
        'O corpo do try segue com continueOnFailure e o catch foi para ' +
        `onFailureAction: ${lost}.`,
    );

    pushReviewNote(
      ctx,
      'CATCH',
      `O AP nao tem try/catch. O corpo do try segue com continueOnFailure. ` +
        `O catch foi para onFailureAction: ${lost}.`,
      lost,
      anchor,
    );
  }
  notePendingJobContext(ctx, anchor);
  if (ctx.catchMessageHits.n > 0) {
    const catchNote = [...ctx.canvasNotes].reverse().find((note) => note.kind === 'CATCH');
    const sentence =
      'Mensagem do catch ficou o texto erro. O iPaaS le o erro em step[\'error\'][\'message\'], mas o import do schema 20 coloca [\'output\'] na frente.';
    if (catchNote && !catchNote.content.includes(sentence)) catchNote.content += `\n\n${sentence}`;
  }
  for (const handler of handlers) {
    if (handler.keyword !== 'stop' || String(handler.input?.stop_with_error) !== 'true') continue;
    ctx.todos.push('STOP: stop_with_error — AP nao tem equivalente; revisar (erro explicito).');
    pushReviewNote(
      ctx,
      'STOP',
      'Workato stop_with_error no catch — o AP nao tem equivalente. Esta nota marca o ponto onde a receita parava com erro explicito. Recriar o tratamento manualmente.',
      '',
      anchor,
    );
  }

  return first ?? null;
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
  const opKey = root.opKey ?? `${root.provider}/${root.name}`;
  const entry = lookupMap(ctx.merged, opKey);
  if (String(root.provider ?? '').includes('recipe_function') && root.name === 'execute') {
    ctx.subflowResultLabels = resultLabelsFromSchema(root.input?.result_schema_json);
  }
  const nextAction = gateOnTriggerFilter(root, buildChain(root.children, ctx), ctx);

  if (entry?.target?.kind === 'trigger') {
    const t = entry.target;
    ctx.piecesUsed.add(t.piece);
    let input = convInput(root.input, entry, ctx);
    if (t.piece === SUBFLOW_PIECE && t.name === 'callableFlow') {
      input = shapeCallableFlow(root.input ?? {});
    }
    if (opKey === 'clock/scheduled_event' && t.name === 'cron_expression') {
      const cron = workatoScheduleToCron(root.input);
      if (cron) input.cronExpression = cron;
      if (!input.timezone) input.timezone = 'UTC';
      const note = scheduleCronTodo(root.input, cron ?? '');
      if (note) ctx.todos.push(note);
    }
    const missing = missingRequiredProps(ctx, t, input);
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

export function buildFlow(recipe: ParsedRecipe, merged: Record<string, MapEntry>, kb: Kb): BuildResult {
  nameSeq = 0;
  NOW = new Date().toISOString();
  const ctx: Ctx = {
    merged,
    kb: new Map(kb.pieces.map((p) => [p.name, p])),
    asToName: new Map(),
    loopScope: [],
    piecesUsed: new Set(),
    todos: [],
    canvasNotes: [],
    recipeName: recipe.name,
    recipeId: recipe.workatoId,
    jobContextHits: emptyHits(),
    jobContextNoted: emptyHits(),
    catchMessageHits: { n: 0 },
    counter: { n: 1 },
    pendingCode: [],
    vars: indexVariables(recipe.root),
    subflowResultLabels: new Map(),
  };
  assignNames(recipe.root, ctx, true);
  // Só `store` é aproximação (round-trip pelo storage); `static`/`linear` sao
  // traducao fiel e nao devem invalidar o flow.
  for (const decl of ctx.vars.decls.values()) {
    const note = describeStrategy(decl);
    if (note) ctx.todos.push(note);
  }
  const trigger = buildTrigger(recipe.root, ctx);
  notePendingJobContext(ctx, lastStepName(trigger));

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
  return { flow, todos: [...new Set(ctx.todos)] };
}
