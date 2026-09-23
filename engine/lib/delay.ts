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

/** `sleep N` (literal) ou `sleep(input['chave'])`, o intervalo vindo do `code_input`. */
export type RubySleep = { seconds: number } | { inputKey: string };

const RUBY_SLEEP = /^(?:Kernel\.)?sleep\s*(?:\(\s*(.+?)\s*\)|([^(].*?))\s*(?:#.*)?$/i;
const SLEEP_LITERAL = /^\d+(?:\.\d+)?$/;
const SLEEP_INPUT = /^input\[\s*(['"])([^'"]+)\1\s*\]$/;

/**
 * Corpo Ruby que só dorme. O boilerplate de comentário que a Workato coloca em
 * todo step de código não conta; qualquer outra instrução invalida o recorte,
 * porque aí o passo faz mais do que esperar.
 */
export function parseRubySleep(raw: unknown): RubySleep | null {
  if (raw == null) return null;
  const body = String(raw)
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
  if (body.length !== 1) return null;
  const match = body[0]!.trim().match(RUBY_SLEEP);
  if (!match) return null;
  const arg = (match[1] ?? match[2] ?? '').trim();
  if (SLEEP_LITERAL.test(arg)) return { seconds: Number(arg) };
  const fromInput = arg.match(SLEEP_INPUT);
  return fromInput ? { inputKey: fromInput[2]! } : null;
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
