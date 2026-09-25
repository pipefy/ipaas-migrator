// Le um recipe JSON do Workato e devolve o que a decisao de pipe precisa:
// conexoes por natureza e pipes tocados por natureza.
//
// Observado nos JSONs vindos da API do Workato (nao do export .zip):
// - `config[].account_id` e o ID numerico da conexao, ou null para built-in.
// Conector Pipefy: o nome traz "pipefy", ou e o OEM
// new_connector_6_connector_186728 (esse nao tem a palavra pipefy).
// Nao usar _connector_186728_: Google Docs, Azure AD, WhatsApp, PDF e Omie
// tambem foram publicados nessa conta OEM e nao sao Pipefy.

const HTTP_PROVIDER = 'rest';

const EXTERNAL_LABEL = {
  slack_bot: 'Slack',
  open_ai: 'OpenAI',
  google_sheets: 'Sheets',
  google_big_query: 'BigQuery',
};

// Steps do conector Pipefy que alteram dados.
const WRITE_STEPS = new Set([
  'create_card',
  'update_card',
  'update_card_field',
  'update_array_type_field',
  'move_card',
  'delete_card',
  'create_record',
  'update_record',
  'delete_record',
]);

const TABLE_STEPS = new Set([
  'get_record_by_id',
  'create_record',
  'update_record',
  'delete_record',
  'record_created',
  'record_updated',
]);

// Pipe citado só dentro do GraphQL de custom_api_call, sem input.pipe_id.
// Aceita pipe(id: N) e "pipe_id": N. Nao assume o prefixo de uma organizacao.
const PIPE_ID_IN_TEXT = /(?:pipe\(\s*id\s*:\s*"?(\d+)"?|["']pipe_id["']\s*:\s*"?(\d+)"?)/gi;

const MUTATION_IN_GRAPHQL = /mutation|createCard|updateCard|moveCard|updateFieldsValues|deleteCard|createComment/i;

export function isPipefyProvider(p) {
  const name = String(p ?? '');
  if (/pipefy/i.test(name)) return true;
  return name.includes('new_connector_6_connector_186728');
}

export const IPAAS_PIECE = {
  Slack: '@activepieces/piece-slack',
  OpenAI: '@activepieces/piece-openai',
  Sheets: '@activepieces/piece-google-sheets',
  BigQuery: '@activepieces/piece-google-bigquery',
};

/**
 * Conexoes que o iPaaS do hospedeiro precisa reproduzir.
 * HTTP nao entra. Varias contas Pipefy no Workato viram UMA service account.
 * Varias contas do mesmo tipo externo viram N conexoes daquela piece.
 */
export function slotsIpaas(p) {
  const slots = [];
  if (p.pipefyConns.length) {
    slots.push({
      kind: 'pipefy',
      label: 'Pipefy',
      piece: '@activepieces/piece-pipefy',
      workatoAccounts: [...p.pipefyConns],
      quantity: 1,
      requireServiceAccount: true,
    });
  }
  const accounts = p.externalAccounts ?? Object.fromEntries(
    (p.externals ?? []).map((label) => [label, p.externalConnIds?.[label] ? [String(p.externalConnIds[label])] : []]),
  );
  for (const label of [...Object.keys(accounts)].sort()) {
    const ids = [...new Set((accounts[label] ?? []).map(String))];
    slots.push({
      kind: 'external',
      label,
      piece: IPAAS_PIECE[label] ?? null,
      workatoAccounts: ids,
      quantity: Math.max(1, ids.length),
      requireServiceAccount: false,
    });
  }
  return slots;
}

function connectionRef(account) {
  if (account == null) return null;
  if (typeof account !== 'object') return String(account).trim();
  return String(account.name ?? account.zip_name ?? 'conexao sem identificador').trim();
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit);
}

export function parseRecipeProfile(json) {
  const code = typeof json.code === 'string' ? JSON.parse(json.code) : json.code;
  const config = typeof json.config === 'string' ? JSON.parse(json.config) : (json.config ?? []);

  const pipefyConns = new Set();
  const externals = new Map(); // label -> Set of Workato account ids
  const httpConns = new Set();
  const builtins = new Set();

  const addExternal = (label, account) => {
    const set = externals.get(label) ?? new Set();
    set.add(account);
    externals.set(label, set);
  };

  for (const c of Array.isArray(config) ? config : []) {
    const provider = String(c?.provider ?? '');
    const account = connectionRef(c?.account_id);
    if (account === null) {
      builtins.add(provider);
    } else if (isPipefyProvider(provider)) {
      pipefyConns.add(account);
    } else if (provider === HTTP_PROVIDER) {
      httpConns.add(account);
    } else {
      addExternal(EXTERNAL_LABEL[provider] ?? provider, account);
    }
  }

  const writeCount = new Map();
  const readCount = new Map();
  const hiddenPipes = new Set();
  const tables = new Set();
  const lookupTables = new Set();
  let trigger = null;
  let triggerPipe = null;
  let customApiCalls = 0;
  let customApiMutates = false;

  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  walk(code, (n) => {
    const provider = n.provider ? String(n.provider) : null;
    if (provider === 'lookup_table') lookupTables.add(String(n.name ?? 'lookup_table'));
    if (n.keyword === 'trigger' && provider && !trigger) {
      trigger = `${provider}/${n.name ?? ''}`;
      if (n.input?.pipe_id != null) triggerPipe = String(n.input.pipe_id);
    }
    if (!provider || !isPipefyProvider(provider)) return;

    const name = String(n.name ?? '');
    const input = n.input ?? {};
    if (input.table_id != null) tables.add(String(input.table_id));
    if (TABLE_STEPS.has(name) || /^record_/.test(name)) {
      tables.add(String(input.table_id ?? 'table'));
    }

    if (name === 'custom_api_call') {
      customApiCalls++;
      const body = JSON.stringify(input);
      for (const m of body.matchAll(PIPE_ID_IN_TEXT)) hiddenPipes.add(m[1] || m[2]);
      if (MUTATION_IN_GRAPHQL.test(body)) customApiMutates = true;
      return;
    }

    if (input.pipe_id == null) return;
    const pipe = String(input.pipe_id);
    if (WRITE_STEPS.has(name)) bump(writeCount, pipe);
    else if (n.keyword !== 'trigger') bump(readCount, pipe);
  });

  const writePipes = [...writeCount.keys()];
  const readPipes = [...readCount.keys()].filter((p) => !writeCount.has(p));
  const onlyHidden = [...hiddenPipes].filter((p) => !writeCount.has(p) && !readCount.has(p) && p !== triggerPipe);

  const touched = [...new Set([...(triggerPipe ? [triggerPipe] : []), ...writePipes, ...readPipes, ...onlyHidden])];

  return {
    recipe: json.name,
    recipeId: json.id != null ? String(json.id) : null,
    workatoUserId: json.user_id != null ? String(json.user_id) : null,
    pipefyConns: [...pipefyConns],
    externals: [...externals.keys()].sort(),
    externalConnIds: Object.fromEntries([...externals].map(([k, set]) => [k, [...set][0]])),
    externalAccounts: Object.fromEntries([...externals].map(([k, set]) => [k, [...set]])),
    httpConns: [...httpConns],
    builtins: [...builtins].sort(),
    trigger,
    triggerPipe,
    writePipes,
    writeCount: Object.fromEntries(writeCount),
    readPipes,
    readCount: Object.fromEntries(readCount),
    hiddenPipes: onlyHidden,
    customApiCalls,
    customApiMutates,
    tables: [...tables],
    lookupTables: [...lookupTables],
    touched,
  };
}

/** Categoria por conexao. O que separa de verdade e ter externa ou nao. */
export function categoria(p) {
  if (p.externals.length > 0) return 'C3';
  if (p.pipefyConns.length === 0) return 'C0';
  if (p.pipefyConns.length === 1) return 'C1';
  return 'C2';
}

/**
 * Candidato a hospedeiro, em ordem de forca. O gatilho manda: no iPaaS o flow
 * nasce colado no pipe do trigger. Sem trigger Pipefy, manda quem escreve.
 */
export function candidatos(p) {
  const out = [];
  const push = (pipe, motivo, empate = false) => {
    if (pipe && !out.some((o) => o.pipe === pipe)) out.push({ pipe, motivo, empate });
  };

  if (p.triggerPipe) push(p.triggerPipe, `gatilho Pipefy ${p.trigger} escuta esse pipe`);

  const byCount = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const w = byCount(p.writeCount);
  if (w.length === 1) push(w[0][0], `unico pipe de escrita (${w[0][1]} step${w[0][1] > 1 ? 's' : ''})`);
  if (w.length > 1) {
    const empate = w[0][1] === w[1][1];
    push(w[0][0], `mais steps de escrita (${w[0][1]} de ${w.length} pipes)`, empate);
    for (const [pipe, n] of w.slice(1)) push(pipe, `tambem escreve (${n})`, empate);
  }

  const r = byCount(p.readCount);
  for (const [pipe, n] of r) push(pipe, `so leitura (${n})`);
  for (const pipe of p.hiddenPipes) push(pipe, 'aparece apenas no GraphQL de custom_api_call');

  return out;
}

/**
 * Destino da skill: hospedeiro existente, criar pipe novo, ou humano.
 * Sem conector Pipefy: criar_pipe (o flow iPaaS precisa de um pipe, mesmo
 * quando a receita so fala com Slack/HTTP/OpenAI).
 * Sem gatilho Pipefy, quem escreve vence quem so e lido.
 * Empate de escrita: null.
 */
export function sugestao(p, cands = candidatos(p)) {
  if (p.pipefyConns.length === 0) {
    return {
      tipo: 'criar_pipe',
      pipe: null,
      motivo: 'nenhum conector Pipefy; o flow precisa de um pipe hospedeiro novo',
    };
  }

  if (!cands.length) return null;
  if (cands[0].empate) return null;

  if (!p.triggerPipe && p.writePipes.length === 1) {
    const pipe = p.writePipes[0];
    const soLeitura = p.readPipes.filter((r) => r !== pipe);
    const motivo = soLeitura.length
      ? `unico pipe de escrita; ${soLeitura.join(', ')} so e lido e nao define o hospedeiro`
      : cands.find((c) => c.pipe === pipe)?.motivo ?? 'unico pipe de escrita';
    return { tipo: 'hospedeiro', pipe, motivo };
  }

  return { tipo: 'hospedeiro', pipe: cands[0].pipe, motivo: cands[0].motivo };
}
