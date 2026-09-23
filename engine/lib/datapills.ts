// Conversao de data pills / formulas Workato -> templates Activepieces.
import type { FormulaHit } from './types.ts';

const RUBY_METHODS = [
  'where', 'pluck', 'gsub', 'smart_join', 'split', 'slice_after', 'map', 'select',
  'reject', 'to_s', 'to_i', 'to_f', 'strip', 'downcase', 'upcase', 'present?', 'blank?',
];

/** true se a string contem qualquer data pill / formula Workato. */
export function hasPill(s: string): boolean {
  return typeof s === 'string' && (/#\{/.test(s) || s.startsWith('='));
}

/**
 * Formula Workato sem corpo: `=`, `=()`, `=null`, `=clear`. Campo em branco
 * ou "limpar valor" — o equivalente no AP e o campo vazio. `=skip` e outra
 * coisa (nao atualizar) e o builder descarta a chave antes de chegar aqui.
 */
const EMPTY_FORMULA = /^=\s*(?:\(\s*\)|null|clear)?\s*$/i;

/** `="texto"` / `='texto'` sem metodo: literal com prefixo de formula. Nao atravessa a aspa de fechamento. */
const LITERAL_FORMULA = /^=\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*$/;

/** `_dp(...)` / `#{_dp(...)}` com zero ou mais `['campo']` — nao e formula Ruby.
 *  A aspa de fechamento do pill e a primeira: `.*` engolia um `.gsub(..., '')` depois. */
const SIMPLE_PILL = /^(?:#\{)?_(?:dp)?\('[^']*'\)\}?(?:\[['"]\w+['"]\])*$/;

/**
 * Formula Workato (`=...`) que nao e apenas uma data pill. Ex.: `=now + 24.hours`.
 * Nao ha equivalente direto em template AP, entao vira revisao humana.
 */
export function isRubyExpression(s: string): boolean {
  if (typeof s !== 'string' || !s.startsWith('=')) return false;
  if (EMPTY_FORMULA.test(s) || LITERAL_FORMULA.test(s)) return false;
  const body = s.slice(1).trim();
  if (SIMPLE_PILL.test(body)) return false;
  if (parseIncludeFormula(s)) return false;
  const peeled = peelTrailingCaseMethod(s);
  if (peeled) {
    const inner = peeled.inner.startsWith('=') ? peeled.inner : `=${peeled.inner}`;
    return isRubyExpression(inner);
  }
  return true;
}

/** `"A", "B"` / `'A','B'` — lista Ruby de strings. Qualquer outro token aborta. */
export function parseRubyStringList(src: string): string[] | null {
  const values: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let started = false;
  for (const ch of src) {
    if (quote) {
      if (escaped) {
        cur += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
        values.push(cur);
        cur = '';
        started = true;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      if (!started) return null;
      started = false;
      continue;
    }
    if (/\s/.test(ch)) continue;
    return null;
  }
  if (quote || escaped) return null;
  if (!started && values.length === 0) return null;
  if (!started) return null;
  return values;
}

/** `=_dp(...).upcase` / `_dp(...).downcase` — so o metodo de caixa no fim. */
export function peelTrailingCaseMethod(
  input: string,
): { inner: string; method: 'upcase' | 'downcase' } | null {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(/^(.*)\.(upcase|downcase)$/);
  if (!m) return null;
  return { inner: m[1]!, method: m[2] as 'upcase' | 'downcase' };
}

export interface IncludeFormula {
  values: string[];
  needleRaw: string;
  caseFold: boolean;
}

/**
 * `=["A","B"].include?(_dp(...).upcase)` — membership Workato sobre uma lista
 * literal. O needle volta como formula `=` para o convertPills normal.
 */
export function parseIncludeFormula(input: string): IncludeFormula | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^=/, '');
  const m = s.match(/^\[(.*)\]\.include\?\((.+)\)$/s);
  if (!m) return null;
  const values = parseRubyStringList(m[1]!);
  if (!values || values.length === 0) return null;
  let needle = m[2]!.trim();
  let caseFold = false;
  const peeled = peelTrailingCaseMethod(needle);
  if (peeled) {
    needle = peeled.inner;
    caseFold = true;
  }
  const needleRaw = needle.startsWith('=') || needle.startsWith('#{') ? needle : `=${needle}`;
  if (isRubyExpression(needleRaw) && !peelTrailingCaseMethod(needleRaw)) return null;
  return { values, needleRaw, caseFold };
}

function wrapApFormula(expr: string): string {
  return `ap-formula-v1::{${expr}}::ap-formula-v1`;
}

/** Nomes oficiais do catalogo AP (`packages/core/formula`): `uppercase` / `lowercase`. */
function apCaseFn(method: string): 'uppercase' | 'lowercase' {
  return method === 'upcase' ? 'uppercase' : 'lowercase';
}

/**
 * `["A","B"].include?(x)` no Workato. AP nao tem `in()`; o equivalente e
 * `contains_item` sobre lista, mas literal de array nao e confiavel no
 * parser — `or(is_equal; ...)` usa so funcoes do catalogo.
 */
function membershipFormula(needle: string, values: string[]): string {
  const eqs = values.map((v) => `is_equal(${needle}; "${escapeFormulaString(v)}")`);
  return eqs.slice(1).reduce((acc, term) => `or(${acc}; ${term})`, eqs[0]!);
}

function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Depois das pills virarem `{{...}}`, fecha `.upcase` / `[].include?` conhecidos. */
function convertKnownRubyAfterPills(out: string): string | null {
  let s = out.trim();
  if (s.startsWith('=')) s = s.slice(1).trim();

  const include = s.match(/^\[(.*)\]\.include\?\((.+)\)$/s);
  if (include) {
    const values = parseRubyStringList(include[1]!);
    if (!values) return null;
    let needle = include[2]!.trim();
    const peeled = peelTrailingCaseMethod(needle);
    if (peeled) {
      needle = `${apCaseFn(peeled.method)}(${peeled.inner})`;
    }
    return wrapApFormula(membershipFormula(needle, values));
  }

  const caseM = s.match(/^(\{\{[^}]+\}\})\.(upcase|downcase)$/);
  if (caseM) {
    return wrapApFormula(`${apCaseFn(caseM[2]!)}(${caseM[1]})`);
  }

  // O evento ja grava time_zone. convert_timezone devolve texto de exibicao.
  const tz = s.match(
    /^(\{\{[^{}]+\}\})\.in_time_zone\("([A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)+)"\)(?:\+(\d+)\.hours)?$/,
  );
  if (tz) {
    if (!tz[3]) return tz[1]!;
    return wrapApFormula(`add_hours(${tz[1]}; ${tz[3]})`);
  }

  const pillObject = convertPillObject(s);
  if (pillObject) return pillObject;

  const catalog = convertCatalogFormula(s);
  if (catalog) return wrapApFormula(catalog);
  return null;
}

/** `{ "k": {{pill}}, ... }` no body HTTP. Nao e formula: o campo fica o JSON. */
function convertPillObject(s: string): string | null {
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  const parts = s.slice(1, -1).split(',');
  if (!parts.length) return null;
  for (const part of parts) {
    if (!/^\s*"[^"]+"\s*:\s*\{\{[^{}]+\}\}\s*$/.test(part)) return null;
  }
  return s;
}

/** Literal seguro como argumento de formula: sem aspas, barra ou quebra de linha. */
function isSafeFormulaArg(value: string): boolean {
  return value.length > 0 && !/["'\\\n\r;]/.test(value);
}

/**
 * Recortes Ruby com equivalente EXATO no catalogo de data manipulation do AP
 * (`format_date`, `replace`, ...). So entra aqui o que nao depende de
 * semantica Ruby (inspect de array, `skip`, `quote`): o resto vai para CODE.
 *
 * Argumentos com aspas/barra ficam de fora de proposito — a serializacao da
 * formula nao tem escape documentado, e um argumento mal formado quebraria o
 * campo em silencio.
 */
function convertCatalogFormula(src: string): string | null {
  const s = src.trim();

  // `today` / `today+5.days`
  if (/^today$/.test(s)) return 'today()';
  const todayPlus = s.match(/^today\s*\+\s*(\d+)\.days?$/);
  if (todayPlus) return `add_days(today(); ${todayPlus[1]})`;

  // `{{pill}}+1`
  const plus = s.match(/^(\{\{[^{}]+\}\})\s*\+\s*(\d+)$/);
  if (plus) return `add(to_number(${plus[1]}); ${plus[2]})`;

  if (s === 'now.to_date') return 'today()';

  const firstItem = s.match(/^(\{\{[^{}]+\}\})\.first\(\)$/);
  if (firstItem) return `first_item(${firstItem[1]})`;

  const whereChain = convertWhereChain(s);
  if (whereChain) return whereChain;

  // `{{pill}}.strftime("%d/%m/%Y")`, com `.to_date` / `.to_s` opcionais.
  const strftime = s.match(
    /^(\{\{[^{}]+\}\})(?:\.to_date)?\.strftime\((['"])([^'"\\]+)\2\)(?:\.to_s)?$/,
  );
  if (strftime) {
    const format = strftime[3]!;
    const tokens = strftimeToApTokens(format);
    if (tokens) {
      const fn = /%[HIMSpl]/.test(format) && !/%[dmYy]/.test(format)
        ? 'format_time'
        : 'format_date';
      const date = strftime[0].includes('.to_date.strftime') ? `to_date(${strftime[1]})` : strftime[1];
      return `${fn}(${date}; ${tokens})`;
    }
  }

  // `{{pill}}.gsub("de", "para")` encadeado, so com literais seguros
  const gsub = parseGsubChain(s);
  if (gsub) return gsub;

  // `{{pill}}.include?("a") || {{pill}}.include?("b")`
  const includes = parseIncludeChain(s);
  if (includes) return includes;

  // `{{pill}}.match?(/PHD/)` — teste booleano. Sem funcao regex no catalogo;
  // padrao literal (sem metacaractere e sem flag) e `contains`.
  const match = parseLiteralMatch(s);
  if (match) return match;

  // `{{pill}}.split("```json").last.split("```").first`
  const between = s.match(
    /^(\{\{[^{}]+\}\})\.split\("([^"\\]+)"\)\.last\.split\("([^"\\]+)"\)\.first$/,
  );
  if (between && isSafeFormulaArg(between[2]!) && isSafeFormulaArg(between[3]!)) {
    return `extract_between(${between[1]}; "${between[2]}"; "${between[3]}")`;
  }
  return null;
}

/**
 * `.where(name: 'X').pluck('value')...` vira filter_list + pluck.
 * O `.to_json.scan(/"value":.../)` do Workato so relia o campo; nao entra na formula.
 * `.compact.first&.[]('value')` fica para o compilador (o dig extra nao tem funcao).
 */
function convertWhereChain(s: string): string | null {
  const head = s.match(/^(\{\{[^{}]+\}\})\.where\(name:\s*'([^']*)'\)([\s\S]*)$/);
  if (!head) return null;
  const pill = head[1]!;
  const name = head[2]!;
  if (/["\\\n\r;]/.test(name)) return null;
  const list = `filter_list(${pill}; "name"; "${name}")`;
  const plucked = `pluck(${list}; "value")`;
  const first = `first_item(${plucked})`;
  const scan = String.raw`.to_json.scan(/"value":"([^"]+)"/).flatten.first`;
  const tails: Record<string, string> = {
    [`.pluck('value')${scan}`]: first,
    [`.pluck('value')${scan}.to_s`]: first,
    [scan]: first,
    ".pluck('value').compact.first": first,
    ".pluck('value').compact.first.to_s": first,
    ".pluck('value').first": first,
    ".pluck('value').compact.join": `join_list(${plucked}; "")`,
  };
  return tails[head[3]!] ?? null;
}

/** `%d/%m/%Y` -> `DD/MM/YYYY`. Devolve null se houver diretiva fora do recorte. */
function strftimeToApTokens(format: string): string | null {
  const map: Record<string, string> = {
    '%d': 'DD', '%m': 'MM', '%Y': 'YYYY', '%y': 'YY',
    '%H': 'HH', '%M': 'mm', '%S': 'ss',
  };
  let out = '';
  for (let i = 0; i < format.length; i++) {
    if (format[i] === '%') {
      const token = map[format.slice(i, i + 2)];
      if (!token) return null;
      out += token;
      i++;
      continue;
    }
    if (!/[\s/:\-.]/.test(format[i]!)) return null;
    out += format[i];
  }
  return out.length ? out : null;
}

/** `.gsub(a, b).gsub(c, d)` sobre uma pill -> replace/remove aninhados. */
function parseGsubChain(s: string): string | null {
  const head = s.match(/^(\{\{[^{}]+\}\})((?:\.gsub\("[^"\\]*",\s*"[^"\\]*"\))+)$/);
  if (!head) return null;
  let expr = head[1]!;
  for (const call of head[2]!.matchAll(/\.gsub\("([^"\\]*)",\s*"([^"\\]*)"\)/g)) {
    const find = call[1]!;
    const to = call[2]!;
    if (!isSafeFormulaArg(find)) return null;
    if (to.length && !isSafeFormulaArg(to)) return null;
    expr = to.length ? `replace(${expr}; "${find}"; "${to}")` : `remove(${expr}; "${find}")`;
  }
  return expr;
}

/**
 * `.match?(/texto/)` sem flag e sem metacaractere. `String#match?` devolve
 * true/false; o catalogo nao tem `regex`, e o teste literal e `contains`.
 * `/a.c/`, `/a|b/` e `/phd/i` ficam de fora (nao sao substring).
 */
function parseLiteralMatch(s: string): string | null {
  const m = s.match(/^(\{\{[^{}]+\}\})\.match\?\(\/((?:\\.|[^/\n])+)\/([imx]*)\)$/);
  if (!m || m[3]) return null;
  const source = m[2]!.replace(/\\\//g, '/');
  if (/[.*+?^$|()[\]{}\\]/.test(source)) return null;
  if (!isSafeFormulaArg(source)) return null;
  return `contains(${m[1]}; "${source}")`;
}

/** `.include?("a")` (opcionalmente com `||`) -> contains / or(contains; ...). */
function parseIncludeChain(s: string): string | null {
  const parts = s.split('||').map((part) => part.trim());
  const terms: string[] = [];
  for (const part of parts) {
    const m = part.match(/^(\{\{[^{}]+\}\})\.include\?\("([^"\\]+)"\)$/);
    if (!m || !isSafeFormulaArg(m[2]!)) return null;
    terms.push(`contains(${m[1]}; "${m[2]}")`);
  }
  if (!terms.length) return null;
  if (terms.length === 1) return terms[0]!;
  return terms.slice(1).reduce((acc, term) => `or(${acc}; ${term})`, terms[0]!);
}

/** metodos Ruby detectados na string (indicam necessidade de step CODE). */
export function detectRubyMethods(s: string): string[] {
  const found = new Set<string>();
  for (const m of RUBY_METHODS) {
    const re = new RegExp('\\.' + m.replace('?', '\\?') + '\\b|\\.' + m.replace('?', '') + '\\(');
    if (re.test(s)) found.add(m);
  }
  if (/\?[^:]*:/.test(s)) found.add('ternary'); // a ? b : c
  return [...found];
}

/** classifica uma string de input como formula (e se precisa de CODE). */
export function analyzeFormula(s: string): FormulaHit | null {
  if (!hasPill(s)) return null;
  if (parseIncludeFormula(s)) return { raw: s, rubyMethods: [], needsCode: false };
  const peeled = peelTrailingCaseMethod(s);
  if (peeled) {
    const inner = peeled.inner.startsWith('=') ? peeled.inner : `=${peeled.inner}`;
    if (!isRubyExpression(inner)) return { raw: s, rubyMethods: [], needsCode: false };
  }
  const rubyMethods = detectRubyMethods(s);
  return { raw: s, rubyMethods, needsCode: rubyMethods.length > 0 };
}

/**
 * Dado o template da colecao iterada (ex. `{{step_3.nodes}}`), devolve o item
 * do foreach que a itera no escopo atual (ex. `loop_2.item`).
 */
export type LoopItemResolver = (collection: string) => string | undefined;

/** Contagem de pills `job_context` já traduzidas nesta receita. */
export type JobContextHits = { name: number; id: number; link: number };

export type PillOptions = {
  recipeName?: string;
  recipeId?: string;
  jobContextHits?: JobContextHits;
  /** Pills `provider: catch` trocadas pelo texto `erro`. */
  catchMessageHits?: { n: number };
};

/** Marcador interno. `convertPills` tira do texto antes de devolver. */
const FLOW_LINK = '\u0000flow-link\u0000';

function renderJobContext(key: string | undefined, options: PillOptions | undefined): string | null {
  const hits = options?.jobContextHits;
  if (key === 'recipe_name') {
    if (hits) hits.name += 1;
    return options?.recipeName ?? '';
  }
  if (key === 'recipe_id') {
    if (hits) hits.id += 1;
    return options?.recipeId ?? '';
  }
  if (key === 'recipe_url' || key === 'job_url') {
    if (hits) hits.link += 1;
    return FLOW_LINK;
  }
  return null;
}

function tidyJobContext(text: string): string {
  if (!text.includes(FLOW_LINK)) return text;
  return text
    .split(FLOW_LINK)
    .join('')
    .replace(/[ \t]*\([ \t]*\)/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]*[^:\n]{1,80}:[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Nome do step AP para o `as` Workato. Objeto quando o payload da piece mora
 * dentro de um envelope (Pipefy: `data`, e `data.card` no getCardById);
 * string simples nos demais casos.
 *
 * Nao usar `output` aqui: isso e o envelope do step no schema AP 21+
 * (release 0.85.4). O iPaaS prefixa `['output']` no import de um flow v20.
 * Gravando `output` no template, a migracao vira `['output'].output...`.
 */
export type StepBinding = string | { name: string; outputRoot?: string };

export type StepNameMap = Map<string, StepBinding>;

export function stepBindingName(binding: StepBinding | undefined): string | undefined {
  if (binding == null) return undefined;
  return typeof binding === 'string' ? binding : binding.name;
}

export function stepOutputRoot(binding: StepBinding | undefined): string | undefined {
  if (!binding || typeof binding === 'string') return undefined;
  return binding.outputRoot;
}

/** Segmentos do envelope da piece. Evita `data.card.card` se o path Workato ja comeca com `card`. */
export function outputRootSegments(
  binding: StepBinding | undefined,
  pathHead?: string,
): string[] {
  const root = stepOutputRoot(binding);
  if (!root) return [];
  const segs = root.split('.').filter(Boolean);
  if (pathHead === 'card' && segs.at(-1) === 'card') return segs.slice(0, -1);
  return segs;
}

function escapeApKey(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** `data.card.id` -> `['data']['card']['id']`. Indice numerico fica `[0]`, sem aspas. */
export function formatApSegment(seg: string): string {
  const indexed = seg.match(/^(.+)\[(\d+)\]$/);
  if (indexed) return `['${escapeApKey(indexed[1]!)}'][${indexed[2]}]`;
  if (/^\d+$/.test(seg)) return `[${seg}]`;
  return `['${escapeApKey(seg)}']`;
}

/**
 * Acesso estilo picker/Copy reference. Ponto vira misto depois da migracao v21
 * (`trigger['output'].data.card.id`); colchete em cada chave vira o amarelo
 * (`trigger['output']['data']['card']['id']`).
 */
export function renderApTemplate(base: string, segments: string[] = []): string {
  return `{{${base}${segments.map(formatApSegment).join('')}}}`;
}

/** `lowercase` / `uppercase` no catalogo AP, depois que as pills ja viraram `{{...}}`. */
export function wrapApCase(value: string, method: 'upcase' | 'downcase'): string {
  const fn = apCaseFn(method);
  const already = value.match(/^ap-formula-v1::\{(.*)\}::ap-formula-v1$/s);
  const inner = already
    ? already[1]!
    : /^\{\{[^{}]+\}\}$/.test(value)
      ? value
      : `"${escapeFormulaString(value)}"`;
  return wrapApFormula(`${fn}(${inner})`);
}

/**
 * Renderiza uma data pill estruturada como template AP.
 *
 * Os elementos de `path` sao normalmente strings, mas alguns sao OBJETOS que
 * denotam uma operacao sobre a lista. Um `join('.')` transformava esses objetos
 * em `[object Object]`, gerando template que nao resolve em runtime — e sem
 * aviso, porque o step continuava valido.
 *
 *  - `current_item`: item atual -> item do foreach que itera a colecao
 *    acumulada ate aqui (resolucao LEXICAL).
 *  - `size`: tamanho da lista -> `.length`.
 *  - `join` / `current_index`: sem equivalente fiel -> TODO.
 */
function renderDataPill(
  json: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string {
  let dp: any;
  try {
    dp = JSON.parse(json);
  } catch {
    return '{{TODO_pill}}';
  }
  const path: any[] = Array.isArray(dp.path) ? dp.path : [];
  if (dp.pill_type === 'job_context') {
    const key = path.find((element) => typeof element === 'string') as string | undefined;
    const job = renderJobContext(key, options);
    if (job !== null) return job;
  }
  const line = dp.line ?? dp.provider;
  const mapped = asToName.get(line);
  const mappedName = stepBindingName(mapped);

  // O catch do Workato nao vira passo. O iPaaS le o erro em step['error']['message'],
  // mas o import do schema 20 insere ['output'] em toda pill e essa referencia nao resolve.
  if (dp.provider === 'catch' && path.every((element) => typeof element !== 'object')) {
    const key = path.filter((element) => typeof element === 'string').join('.');
    if (key === 'message' || key === '') {
      if (options?.catchMessageHits) options.catchMessageHits.n += 1;
      return 'erro';
    }
  }

  // `line` e o `as` do passo de origem. Sem entrada no mapa, a pill aponta para
  // um passo que nao existe na receita — acontece quando o passo e apagado e a
  // referencia fica para tras. Repassar o hash cru gerava template que o AP
  // resolve como vazio em silencio; marcar invalida o step para revisao.
  if (!mappedName && /^[0-9a-f]{6,}$/i.test(String(line))) return `{{TODO_ref_${line}}}`;

  let base = mappedName ?? line;
  const pathHead = path.find((element) => typeof element === 'string') as string | undefined;
  let segments: string[] = outputRootSegments(mapped, pathHead);
  const render = () => renderApTemplate(base, segments);

  for (const element of path) {
    if (!element || typeof element !== 'object') {
      segments.push(String(element));
      continue;
    }
    if (element.path_element_type === 'size') {
      segments.push('length');
      continue;
    }
    if (element.path_element_type === 'current_item') {
      const item = resolveLoopItem?.(render());
      if (item) {
        // Item do foreach e o valor cru, sem o envelope da piece.
        base = item;
        segments = [];
        continue;
      }
      // Sem foreach no escopo. O Workato usa o primeiro item da lista
      // (docs "Lists"); listas sao indexadas em 0.
      if (segments.length) segments[segments.length - 1] += '[0]';
      else base = `${base}[0]`;
      continue;
    }
    return '{{TODO_pill}}';
  }
  return render();
}

function extraHashPath(brackets: string): string {
  return [...brackets.matchAll(/\[['"](\w+)['"]\]/g)].map((m) => m[1]).join('.');
}

function appendPillPath(pill: string, extra: string): string {
  if (!extra) return pill;
  const access = extra.split('.').filter(Boolean).map(formatApSegment).join('');
  if (!/^\{\{[^}]+\}\}$/.test(pill)) return `${pill}${access}`;
  return `{{${pill.slice(2, -2)}${access}}}`;
}

/** `_dp(...)['a']['b']` → `{{step.a.b}}`. */
function convertHashPathFormula(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string | null {
  const m = input.trim().match(
    /^=?(?:#\{)?_dp\('(.+?)'\)\}?((?:\[['"]\w+['"]\])+)$/,
  );
  if (!m) return null;
  return appendPillPath(renderDataPill(m[1], asToName, resolveLoopItem, options), extraHashPath(m[2]));
}

/** `_dp(...).where(field:"val")[0]['key']` → filter_list + first_item + pluck. */
function convertWhereListFormula(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string | null {
  const m = input.trim().match(
    /^=?(?:#\{)?_dp\('(.+?)'\)\}?\.where\((\w+)\s*:\s*"((?:[^"\\]|\\.)*)"\)\[0\]\['(\w+)'\]$/,
  );
  if (!m) return null;
  const listRef = renderDataPill(m[1], asToName, resolveLoopItem, options);
  const field = m[2];
  const value = m[3].replace(/\\"/g, '"').replace(/"/g, '\\"');
  const key = m[4];
  return `ap-formula-v1::{first_item(pluck(filter_list(${listRef};"${field}";"${value}");"${key}"))}::ap-formula-v1`;
}

/**
 * `data.<provider>.<as>.<path>` (forma do `_('...')`) -> template AP.
 *
 * `foreach` expoe `index` como metadado do proprio loop, nao do item: o `as`
 * resolve para `loop_N.item`, mas o indice mora em `loop_N.index`.
 */
function renderDataRef(ref: string, asToName: StepNameMap): string {
  const parts = String(ref).split('.');
  const as = parts[1];
  const path = parts.slice(2).join('.');
  const binding = as ? asToName.get(as) : undefined;
  const mapped = stepBindingName(binding) || parts.slice(0, 2).join('_');
  if (parts[0] === 'foreach' && /^index\b/.test(path)) {
    const loop = mapped.replace(/\.item$/, '');
    return `{{${loop}.${path}}}`;
  }
  const pathHead = path.split('.')[0];
  const segs = outputRootSegments(binding, pathHead);
  return renderApTemplate(mapped, [...segs, ...path.split('.').filter(Boolean)]);
}

/**
 * Converte pills SIMPLES para template AP. Nao resolve formulas com metodo Ruby
 * (essas viram step CODE). asToName: mapa do `as` do Workato -> nome do step AP.
 */
export function convertPills(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string {
  if (typeof input !== 'string') return input;
  if (EMPTY_FORMULA.test(input)) return '';
  const literal = input.match(LITERAL_FORMULA);
  if (literal) return literal[2]!;
  const whereList = convertWhereListFormula(input, asToName, resolveLoopItem, options);
  if (whereList) return tidyJobContext(whereList);
  const hashPath = convertHashPathFormula(input, asToName, resolveLoopItem, options);
  if (hashPath) return tidyJobContext(hashPath);

  let out = input;
  // Formula Ruby (=now + 24.hours): sem equivalente em template AP. Marca de
  // forma visivel no editor em vez de emitir texto que parece literal valido.
  // `.upcase` / `[].include?` conhecidos deixam de contar — viram formula AP.
  const rubyExpression = isRubyExpression(input);

  // 1) pill estruturada: #{_dp('{...json...}')} ou _dp('{...}') sem interpolacao
  out = out.replace(/#\{_dp\('(.+?)'\)\}|_dp\('(.+?)'\)/g, (_m, a, b) => {
    return renderDataPill(a ?? b, asToName, resolveLoopItem, options);
  });

  // 2) pill interpolada: #{_('data.<provider>.<as>.<path>')}
  out = out.replace(/#\{_\('data\.([^']+)'\)\}/g, (_m, ref) => renderDataRef(ref, asToName));

  // 2b) mesma pill SEM interpolacao, dentro de formula: `_('data...')` e
  // `_('data...', 'foreach_meta')`. Sem isso a referencia Workato vazava crua
  // para o template (e para o JS do step CODE), onde nao resolve nada.
  out = out.replace(/_\('data\.([^']+)'(?:\s*,\s*'[^']*')?\)/g, (_m, ref) =>
    renderDataRef(ref, asToName),
  );

  // 3) qualquer #{...} restante -> TODO
  out = out.replace(/#\{[^}]*\}/g, '{{TODO_formula}}');

  // 4) {{step}}['a']['b'] residual (formula mista) -> {{step.a.b}}
  out = out.replace(/\{\{([^{}]+)\}\}((?:\[['"]\w+['"]\])+)/g, (_m, inner, brackets) => {
    return `{{${inner}.${extraHashPath(brackets)}}}`;
  });

  // 5) prefixo '=' de formula
  if (out.startsWith('=')) out = out.slice(1);

  const known = convertKnownRubyAfterPills(out);
  if (known) return tidyJobContext(known);

  return tidyJobContext(rubyExpression ? `TODO_FORMULA(${out.trim()})` : out);
}
