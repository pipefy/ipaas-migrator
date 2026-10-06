// clock/wait_until_time tem dois casos:
//   sleep  — `N.seconds|minutes|hours|days|weeks.from_now` → delayFor (intervalo)
//   until  — horário absoluto / datapill / Ruby que não é esse recorte → delay_until
//
// Custom Ruby cujo corpo é só `sleep N` cai no mesmo delayFor (Delay Utility),
// em vez de virar step CODE para tradução manual.

import type { MapEntry } from './types.ts';
import { lookupMap } from './collapse.ts';

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  seconds: 1,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
  day: 86400,
  days: 86400,
  week: 604800,
  weeks: 604800,
};

/** Workato `=60.seconds.from_now` (e o stub TODO_FORMULA). Extra Ruby depois de from_now não conta. */
export function parseRelativeFromNow(raw: unknown): { seconds: number } | null {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (text.startsWith('=')) text = text.slice(1).trim();
  const wrapped = text.match(/^TODO_FORMULA\((.*)\)$/s);
  if (wrapped) text = wrapped[1]!.trim();
  text = text.replace(/\s+/g, '');
  const match = text.match(/^(\d+)\.(seconds?|minutes?|hours?|days?|weeks?)\.from_now$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const factor = UNIT_SECONDS[match[2]!.toLowerCase()];
  if (!Number.isFinite(amount) || factor == null) return null;
  return { seconds: amount * factor };
}

/** `sleep N`, `sleep(2.minutes)` ou `sleep(input['chave'])`. Unidade vira segundos. */
export type RubySleep = { seconds: number } | { inputKey: string };

/** `rand(5)` é 0..4. `rand(3..10)` é 3..10. `n` sorteado, segundos = n * factor. */
export type RubyRandomSleep = { min: number; span: number; factor: number };

const RUBY_SLEEP = /^(?:Kernel\.)?sleep\s*(?:\(\s*(.+?)\s*\)|([^(].*?))\s*(?:#.*)?$/i;
const SLEEP_LITERAL = /^\d+(?:\.\d+)?$/;
const SLEEP_DURATION = /^(\d+(?:\.\d+)?)\.(seconds?|minutes?|hours?|days?|weeks?)$/i;
/** `rand(5)` ou `rand(3..10).minutes`. O número é inteiro, como o Kernel#rand da Workato. */
const SLEEP_RAND = /^rand\s*\(\s*(\d+)(?:\s*\.\.\s*(\d+))?\s*\)(?:\.(seconds?|minutes?|hours?|days?|weeks?))?$/i;
const SLEEP_INPUT = /^input\[\s*(['"])([^'"]+)\1\s*\]$/;

/** `30` já está em segundos. `2.minutes` vale 120. Singular e plural. */
function durationSeconds(arg: string): number | null {
  if (SLEEP_LITERAL.test(arg)) return Number(arg);
  const duration = arg.match(SLEEP_DURATION);
  if (!duration) return null;
  const amount = Number(duration[1]);
  const factor = UNIT_SECONDS[duration[2]!.toLowerCase()];
  if (!Number.isFinite(amount) || factor == null) return null;
  return amount * factor;
}

/**
 * Corpo Ruby que só dorme um tempo fixo. O boilerplate de comentário que a
 * Workato coloca em todo step de código não conta; qualquer outra instrução
 * invalida o recorte, porque aí o passo faz mais do que esperar.
 * `sleep rand(...)` não entra aqui: continua step CODE e sorteia na execução.
 */
export function parseRubySleep(raw: unknown): RubySleep | null {
  const arg = rubySleepArg(raw);
  if (arg == null) return null;
  const seconds = durationSeconds(arg);
  if (seconds != null) return { seconds };
  const fromInput = arg.match(SLEEP_INPUT);
  return fromInput ? { inputKey: fromInput[2]! } : null;
}

/** `sleep rand(5)` → 0..4. `sleep rand(3..10)` → 3..10. Unidade multiplica o inteiro sorteado. */
export function parseRubyRandomSleep(raw: unknown): RubyRandomSleep | null {
  const arg = rubySleepArg(raw);
  if (arg == null) return null;
  const rand = arg.match(SLEEP_RAND);
  if (!rand) return null;
  const factor = rand[3] ? UNIT_SECONDS[rand[3].toLowerCase()] : 1;
  if (factor == null) return null;
  const upper = Number(rand[2] ?? rand[1]);
  const lower = rand[2] != null ? Number(rand[1]) : 0;
  const span = rand[2] != null ? upper - lower + 1 : upper;
  if (!Number.isInteger(lower) || !Number.isInteger(span) || span < 1 || lower < 0) return null;
  return { min: lower, span, factor };
}

export function randomSleepCode(sleep: RubyRandomSleep): string {
  return [
    'export const code = async () => {',
    `  const n = ${sleep.min} + Math.floor(Math.random() * ${sleep.span});`,
    `  const seconds = n * ${sleep.factor};`,
    '  await new Promise((resolve) => setTimeout(resolve, Math.round(seconds * 1000)));',
    '  return { seconds };',
    '};',
  ].join('\n');
}

function rubySleepArg(raw: unknown): string | null {
  if (raw == null) return null;
  const body = String(raw)
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
  if (body.length !== 1) return null;
  // `sleep(30);` é o mesmo sleep. O ponto-e-vírgula não é outra instrução.
  const line = body[0]!.trim().replace(/;\s*(#.*)?$/, (_full, comment: string | undefined) => comment ?? '');
  const match = line.match(RUBY_SLEEP);
  if (!match) return null;
  return (match[1] ?? match[2] ?? '').trim();
}

/**
 * Valor que o step passa para o `input[...]` do Ruby. `=30` da Workato é o
 * número 30, não uma fórmula a traduzir; datapill segue para a conversão normal.
 */
function fromCodeInput(input: Record<string, any>, key: string): unknown {
  const raw = input?.code_input?.data?.[key];
  if (typeof raw !== 'string') return raw;
  const literal = raw.trim().replace(/^=/, '');
  return SLEEP_LITERAL.test(literal) ? literal : raw;
}

/**
 * Ruby que é só sleep vira a Delay Utility. `null` mantém o passo no caminho do
 * step CODE: sem mapa de delay ou sem intervalo, esperar não é o que ele faz.
 */
export function resolveRubySleep(
  input: Record<string, any>,
  merged: Record<string, MapEntry>,
): { entry: MapEntry; input: Record<string, any> } | null {
  const sleep = parseRubySleep(input?.code);
  if (!sleep) return null;
  const entry =
    lookupMap(merged, 'workato_custom_code/sleep') ?? lookupMap(merged, 'clock/wait_for_interval');
  if (!entry?.target) return null;
  const interval =
    'seconds' in sleep ? String(sleep.seconds) : fromCodeInput(input, sleep.inputKey);
  if (interval == null || String(interval).trim() === '') return null;
  return { entry, input: { interval } };
}

export function resolveWaitUntilTime(
  input: Record<string, any>,
  merged: Record<string, MapEntry>,
): { entry: MapEntry | undefined; input: Record<string, any> } {
  const untilEntry = lookupMap(merged, 'clock/wait_until_time');
  const sleep = parseRelativeFromNow(input?.time);
  if (sleep) {
    const intervalEntry = lookupMap(merged, 'clock/wait_for_interval');
    if (intervalEntry?.target) {
      return { entry: intervalEntry, input: { interval: String(sleep.seconds) } };
    }
  }
  return { entry: untilEntry, input };
}
