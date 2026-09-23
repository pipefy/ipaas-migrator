// Workato clock/scheduled_event → cron de 5 campos do piece-schedule.

function parseTime(triggerAt: unknown): { minute: number; hour: number } {
  const m = String(triggerAt ?? '00:00').match(/(\d{1,2}):(\d{2})/);
  if (!m) return { minute: 0, hour: 0 };
  return {
    hour: Math.min(23, Math.max(0, Number(m[1]))),
    minute: Math.min(59, Math.max(0, Number(m[2]))),
  };
}

function everyN(raw: unknown, min = 1): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= min ? n : min;
}

function weekDays(raw: unknown): string {
  const days = String(raw ?? '')
    .split(/[,\s]+/)
    .map((d) => d.trim())
    .filter(Boolean);
  return days.length ? days.join(',') : '*';
}

/** cronExpression a partir do input Workato. Vazio se nao der para traduzir. */
export function workatoScheduleToCron(input: Record<string, unknown>): string | undefined {
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

export function scheduleCronTodo(input: Record<string, unknown>, cron: string): string | undefined {
  const unit = String(input.time_unit ?? '').toLowerCase();
  const n = everyN(input.trigger_every);
  if ((unit === 'weeks' || unit === 'week') && n > 1) {
    return `PROPS (trigger): Workato trigger_every=${n} weeks nao cabe em cron semanal; gerado ${cron} (toda semana).`;
  }
  if ((unit === 'months' || unit === 'month') && String(input.days_of_month ?? '') === 'last_day') {
    return `PROPS (trigger): days_of_month=last_day virrou dia L no cron (${cron}); confirmar se a piece aceita.`;
  }
  return undefined;
}
