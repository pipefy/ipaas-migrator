// Monta e envia o log silencioso do kit cliente pelo formulário público.
// Captcha ou rede falham sem texto. O feedback fica em disco para a próxima submissão.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { readLocalVersion } from './cliente-versao.mjs';
import { inspectFlowGraph } from './flow-graph-guard.mjs';

export const PUBLIC_API = 'https://app.pipefy.com/public_api';
export const PUBLIC_FORM_ID = 'SvdeZSlT';
export const PENDING_FEEDBACK = 'output/.toolkit-log-feedback.json';

const FIELD_IDS = {
  versao: 'vers_o_do_migrador',
  org: 'org_identificada',
  orgSource: 'origem_da_org',
  feedback: 'feedback_melhoria',
  quem: 'quem',
  resumo: 'resumo_do_lote',
  receitas: 'receitas_traduzidas',
  telemetria: 'telemetria_logs',
};

const ORG_SOURCES = new Set(['login', 'receitas', 'desconhecida']);

const SUBMIT_QUERY = `mutation Submit($input: SubmitPublicFormInput!) {
  submitPublicForm(input: $input) {
    repoItem { id title url }
  }
}`;

const ORG_NAME_KEYS = new Set([
  'organization_name',
  'organizationName',
  'company_name',
  'companyName',
  'org_name',
]);
const ORG_ID_KEYS = new Set(['organization_id', 'organizationId', 'org_id', 'orgId']);
const SKIP_KEYS = new Set([
  'sourcecode',
  'source_code',
  'ruby',
  'password',
  'token',
  'secret',
  'authorization',
  'api_key',
  'apikey',
  'client_secret',
]);

export function readToolkitLogs(root) {
  const path = join(root, 'config.json');
  if (!existsSync(path)) return null;
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    return config.toolkitLogs ?? null;
  } catch {
    return null;
  }
}

export function resolveLogsTarget({ env = process.env, config = null } = {}) {
  if (String(env.MIGRADOR_LOGS ?? '').trim().toLowerCase() === 'off') {
    return { skip: 'off' };
  }
  const url = String(env.MIGRADOR_LOGS_URL ?? '').trim() || String(config?.publicApi ?? '').trim() || PUBLIC_API;
  const formId = String(env.MIGRADOR_LOGS_FORM ?? '').trim() || String(config?.formId ?? '').trim() || PUBLIC_FORM_ID;
  if (!url || !formId) return { skip: 'no_url' };
  return { url, formId };
}

export function pendingFeedbackPath(root) {
  return join(root, PENDING_FEEDBACK);
}

export function readPendingFeedback(path) {
  if (!path || !existsSync(path)) return '';
  try {
    const body = JSON.parse(readFileSync(path, 'utf8'));
    return typeof body?.feedback === 'string' ? body.feedback.trim() : '';
  } catch {
    return '';
  }
}

export function writePendingFeedback(path, feedback) {
  const text = String(feedback ?? '').trim();
  if (!text) {
    clearPendingFeedback(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ feedback: text }, null, 2)}\n`);
}

export function clearPendingFeedback(path) {
  if (path && existsSync(path)) rmSync(path, { force: true });
}

export function mergeFeedback(pending, current) {
  const saved = String(pending ?? '').trim();
  const next = String(current ?? '').trim();
  if (!saved) return next;
  if (!next || saved === next || saved.includes(next)) return saved;
  if (next.includes(saved)) return next;
  return `${saved}\n\n${next}`;
}

export function publicFormBody(payload, formId) {
  const source = ORG_SOURCES.has(payload?.orgSource) ? payload.orgSource : '';
  const values = {
    versao: payload?.versao ?? '',
    org: payload?.org ?? '',
    orgSource: String(payload?.org ?? '').trim() ? source : '',
    feedback: payload?.feedback ?? '',
    quem: payload?.quem ?? '',
    resumo: payload?.resumo ?? '',
    receitas: payload?.receitas ?? '',
    telemetria: payload?.telemetria ?? '',
  };
  const filledFields = Object.entries(values)
    .filter(([key, fieldValue]) => key === 'versao' || String(fieldValue).trim() !== '')
    .map(([key, fieldValue]) => ({
      fieldId: FIELD_IDS[key],
      fieldValue: String(fieldValue),
    }));
  return {
    query: SUBMIT_QUERY,
    variables: {
      input: {
        formId,
        captchaToken: '',
        filledFields,
      },
    },
  };
}

export function captchaBlocked(body) {
  const errors = body?.errors;
  if (!Array.isArray(errors) || !errors.length) return false;
  return errors.some((error) => /captcha/i.test(JSON.stringify(error ?? '')));
}

function literal(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.includes('{{') || text.includes('#{')) return null;
  if (text.length > 160) return null;
  return text;
}

export function orgHintsFromTree(node, found = { name: null, id: null }) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const item of node) orgHintsFromTree(item, found);
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key.toLowerCase())) continue;
    if (!found.name && ORG_NAME_KEYS.has(key)) found.name = literal(value);
    if (!found.id && ORG_ID_KEYS.has(key)) found.id = literal(value);
    if (value && typeof value === 'object') orgHintsFromTree(value, found);
  }
  return found;
}

export function identifyOrg({ login = null, trees = [] } = {}) {
  const fromLogin = literal(login?.organizationName) || literal(login?.organizationId) || literal(login?.projectName);
  if (fromLogin) return { org: fromLogin, source: 'login' };
  const found = { name: null, id: null };
  for (const tree of trees) orgHintsFromTree(tree, found);
  const fromRecipes = found.name || found.id;
  if (fromRecipes) return { org: fromRecipes, source: 'receitas' };
  return { org: '', source: 'desconhecida' };
}

export function migradorIdentity(root) {
  const versionFile = join(root, 'VERSION');
  if (existsSync(versionFile)) {
    const versao = readFileSync(versionFile, 'utf8').trim();
    if (versao) return { migrador: 'cliente', versao };
  }
  const changelog = join(root, 'docs', 'CHANGELOG.md');
  if (existsSync(changelog)) {
    const match = readFileSync(changelog, 'utf8').match(/^## \[(\d+\.\d+\.\d+)\]/m);
    if (match) return { migrador: 'completo', versao: match[1] };
  }
  return { migrador: 'cliente', versao: readLocalVersion(root) ?? '' };
}

export function logSilenced(dir, env = process.env) {
  if (String(env.MIGRADOR_LOGS ?? '').trim().toLowerCase() === 'off') return 'off';
  if (env.VITEST || env.NODE_ENV === 'test') return 'test';
  const norm = String(dir ?? '').replace(/\\/g, '/');
  if (norm.includes('/.tmp/smoke') || norm.endsWith('/smoke') || norm.includes('smoke.recipe.json')) return 'smoke';
  return null;
}

export function logStatePath(dir) {
  return join(dir, '.toolkit-log-state.json');
}

export function payloadHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function graphSummary(flow) {
  if (!flow || typeof flow !== 'object') return null;
  const report = inspectFlowGraph(flow);
  const summary = {
    ok: report.ok,
    totalSteps: report.totalSteps,
    uniqueNames: report.uniqueNames,
  };
  if (report.duplicateNames.length) summary.duplicateNames = report.duplicateNames;
  return summary;
}

function transportSummary(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    limpo: Boolean(report.limpo),
    bloqueia: Array.isArray(report.bloqueia) ? report.bloqueia.length : 0,
    revisar: Array.isArray(report.revisar) ? report.revisar.length : 0,
    structuralErrors: Array.isArray(report.structuralErrors) ? report.structuralErrors.map((item) => item.kind) : [],
  };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function recipeDirs(dir) {
  if (existsSync(join(dir, 'recipe.json')) || existsSync(join(dir, 'status.json'))) return [dir];
  if (!existsSync(dir)) return [];
  const children = [];
  for (const name of readdirSync(dir)) {
    const child = join(dir, name);
    if (!statSync(child).isDirectory()) continue;
    if (existsSync(join(child, 'recipe.json')) || existsSync(join(child, 'status.json'))) children.push(child);
  }
  return children.sort();
}

function connectionLabels(plan) {
  const bindings = Array.isArray(plan?.bindings) ? plan.bindings : [];
  const labels = bindings.map((b) => b?.label).filter((label) => typeof label === 'string' && label.trim());
  return labels;
}

export function entryFromDir(dir) {
  const recipe = readJson(join(dir, 'recipe.json'));
  const flow = readJson(join(dir, 'flow.json'));
  const routing = readJson(join(dir, 'routing.json'));
  const status = readJson(join(dir, 'status.json'));
  const draft = readJson(join(dir, 'draft.json'));
  const plan = readJson(join(dir, 'plan.json'));
  const avaliacao = readJson(join(dir, 'avaliacao.json'));
  const transporte = readJson(join(dir, 'transporte.json'));
  const id = recipe?.id != null ? String(recipe.id) : status?.id != null ? String(status.id) : null;
  const name = recipe?.name ?? status?.receita ?? null;
  const destination = routing?.destination ?? null;
  const url = typeof draft?.url === 'string' ? draft.url : null;
  return {
    id,
    name,
    destination,
    url,
    connections: connectionLabels(plan),
    consultas: Array.isArray(avaliacao?.consultas) ? avaliacao.consultas : null,
    graph: graphSummary(flow),
    transport: transportSummary(transporte),
    trees: [recipe, flow].filter(Boolean),
  };
}

function lineOf(entry) {
  const id = entry.id ?? 'sem id';
  const name = entry.name ?? 'sem nome';
  const destination = entry.destination ?? 'sem destino';
  const url = entry.url ?? 'sem draft';
  return `${id} — ${name} — ${url} — ${destination}`;
}

export function buildPayload({ version, migrador = '', login = null, feedback = '', entries = [] }) {
  const identified = identifyOrg({ login, trees: entries.flatMap((entry) => entry.trees ?? []) });
  const ready = entries.filter((entry) => entry.destination === 'ipaas_ready').length;
  const review = entries.filter((entry) => entry.destination === 'manual_revision').length;
  const connections = [...new Set(entries.flatMap((entry) => entry.connections ?? []))];
  const resumo = [
    `receitas: ${entries.length}`,
    `ipaas_ready: ${ready}`,
    `manual_revision: ${review}`,
    `conexões: ${connections.length ? connections.join(', ') : 'nenhuma'}`,
    ...entries.map((entry) => {
      const id = entry.id ?? 'sem id';
      const name = entry.name ?? 'sem nome';
      return `${id} — ${name} — ${entry.destination ?? 'sem destino'}`;
    }),
  ].join('\n');
  const receitas = entries.length ? entries.map(lineOf).join('\n') : 'nenhuma';
  const consultas = [];
  for (const entry of entries) {
    if (!entry.consultas) continue;
    if (!entry.consultas.length) {
      consultas.push(`${entry.id ?? 'sem id'} — nenhuma`);
      continue;
    }
    for (const item of entry.consultas) {
      const fonte = item?.fonte ?? item?.source ?? 'consulta';
      const motivo = item?.motivo ?? item?.reason ?? item?.porque ?? '';
      const ajuste = item?.ajuste ? ` — ${item.ajuste}` : '';
      consultas.push(`${entry.id ?? 'sem id'} — ${fonte} — ${motivo}${ajuste}`.trim());
    }
  }
  const grafos = entries
    .map((entry) => entry.graph)
    .filter(Boolean)
    .map((graph) => JSON.stringify(graph));
  const transportes = entries
    .map((entry) => entry.transport)
    .filter(Boolean)
    .map((report) => JSON.stringify(report));
  const telemetria = [
    `migrador: ${migrador || 'desconhecido'}`,
    `versão: ${version ?? 'desconhecida'}`,
    `quem: ${literal(login?.email) || 'não informado'}`,
    `org: ${identified.org || 'desconhecida'}`,
    `origem: ${identified.source}`,
    grafos.length ? `grafo: ${grafos.join(' | ')}` : 'grafo: não registrado',
    transportes.length ? `transporte: ${transportes.join(' | ')}` : 'transporte: não registrado',
    consultas.length ? consultas.join('\n') : 'consulta: não registrada',
  ].join('\n');
  return {
    versao: version ?? '',
    org: identified.org,
    orgSource: identified.source,
    quem: literal(login?.email) || '',
    feedback: typeof feedback === 'string' ? feedback.trim() : '',
    resumo,
    receitas,
    telemetria,
  };
}

export function loginFromEnv(env = process.env, flags = {}) {
  return {
    email: flags.who || env.IPAAS_USER || '',
    organizationName: flags.org || env.IPAAS_ORG || '',
    organizationId: flags.orgId || env.IPAAS_ORG_ID || '',
    projectName: flags.project || env.IPAAS_PROJECT_NAME || '',
  };
}

export async function sendClienteLog(payload, target, fetchImpl = fetch) {
  if (!target || target.skip) return { ok: true, skipped: target?.skip ?? 'skip', sent: false, captcha: false };
  try {
    const res = await fetchImpl(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(publicFormBody(payload, target.formId)),
      signal: AbortSignal.timeout(5000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const sent = Boolean(body?.data?.submitPublicForm?.repoItem?.id);
    return { ok: true, http: res?.status ?? null, sent, captcha: !sent && captchaBlocked(body) };
  } catch {
    return { ok: true, http: null, sent: false, captcha: false };
  }
}

export async function deliverClienteLog({ payload, target, pendingPath, fetchImpl = fetch, statePath = null }) {
  const feedback = mergeFeedback(readPendingFeedback(pendingPath), payload?.feedback);
  const next = { ...payload, feedback };
  if (statePath) {
    const hash = payloadHash(next);
    const previous = readJson(statePath);
    if (previous?.hash === hash) return { ok: true, skipped: 'unchanged', sent: false, captcha: false };
    const result = await sendClienteLog(next, target, fetchImpl);
    if (result.sent) {
      try {
        writeFileSync(statePath, `${JSON.stringify({ hash })}\n`);
      } catch {
        /* o próximo envio tenta de novo */
      }
    }
    if (result.skipped || !pendingPath) return result;
    if (result.sent) clearPendingFeedback(pendingPath);
    else if (feedback) writePendingFeedback(pendingPath, feedback);
    return result;
  }
  const result = await sendClienteLog(next, target, fetchImpl);
  if (result.skipped || !pendingPath) return result;
  if (result.sent) clearPendingFeedback(pendingPath);
  else if (feedback) writePendingFeedback(pendingPath, feedback);
  return result;
}

export function collectLog({ root, dir, feedback = '', env = process.env, flags = {}, recipe = null, flow = null }) {
  const identity = migradorIdentity(root);
  const login = loginFromEnv(env, flags);
  if (flags.orgSource === 'login' && flags.org) login.organizationName = flags.org;
  let entries = recipeDirs(dir).map(entryFromDir);
  if (recipe || flow) {
    const id = recipe?.id != null ? String(recipe.id) : null;
    let entry = entries.find((item) => id && item.id === id) ?? entries[0];
    if (!entry) {
      entry = {
        id,
        name: recipe?.name ?? null,
        destination: null,
        url: null,
        connections: [],
        consultas: null,
        graph: null,
        transport: null,
        trees: [],
      };
      entries = [entry];
    }
    if (id && !entry.id) entry.id = id;
    if (recipe?.name && !entry.name) entry.name = recipe.name;
    if (recipe) entry.trees = [...(entry.trees ?? []), recipe];
    if (flow) {
      entry.graph = graphSummary(flow);
      entry.trees = [...(entry.trees ?? []), flow];
    }
  }
  const payload = buildPayload({ version: identity.versao, migrador: identity.migrador, login, feedback, entries });
  if (flags.org && flags.orgSource && ['login', 'receitas', 'desconhecida'].includes(flags.orgSource)) {
    payload.org = flags.org;
    payload.orgSource = flags.orgSource;
  }
  const target = resolveLogsTarget({ env, config: readToolkitLogs(root) });
  return { payload, target };
}

export async function deliverSilentTranslationLog({ root, dir, recipe = null, flow = null, env = process.env }) {
  try {
    const silenced = logSilenced(dir, env);
    if (silenced) return { ok: true, skipped: silenced, sent: false, captcha: false };
    const { payload, target } = collectLog({ root, dir, recipe, flow, env });
    return await deliverClienteLog({
      payload,
      target,
      pendingPath: pendingFeedbackPath(root),
      statePath: logStatePath(dir),
    });
  } catch {
    return { ok: true, sent: false, captcha: false, skipped: 'error' };
  }
}
