// Recipe function da Workato → piece-subflows em mode simple.
// O gabarito (subflows 0.7.0) exige mode; sem ele o step fica inválido.
// flowId do callFlow é o externalId do flow no iPaaS. Aqui só cabe o id Workato.

export const SUBFLOW_PIECE_VERSION = '0.7.0';

export interface SchemaField {
  name?: string;
  label?: string;
  type?: string;
}

export function parseWorkatoSchema(raw: unknown): SchemaField[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((field) => field && typeof field === 'object') : [];
  } catch {
    return [];
  }
}

function sampleFor(type: string | undefined): string | number | boolean {
  const kind = String(type ?? '').toLowerCase();
  if (kind.includes('bool')) return true;
  if (kind.includes('int') || kind.includes('number') || kind.includes('integer')) return 1;
  return '1234';
}

export function sampleDataFromSchema(raw: unknown): Record<string, string | number | boolean> {
  const sample: Record<string, string | number | boolean> = {};
  for (const field of parseWorkatoSchema(raw)) {
    if (!field.name) continue;
    sample[field.name] = sampleFor(field.type);
  }
  return sample;
}

export function resultLabelsFromSchema(raw: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  for (const field of parseWorkatoSchema(raw)) {
    if (!field.name) continue;
    labels.set(field.name, field.label || field.name);
  }
  return labels;
}

export function shapeCallableFlow(input: Record<string, any>): Record<string, any> {
  return {
    mode: 'simple',
    exampleData: { sampleData: sampleDataFromSchema(input.parameters_schema_json) },
  };
}

export function shapeCallFlow(
  input: Record<string, any>,
  asyncCall: boolean,
): { input: Record<string, any>; flowIdNote: string | null } {
  const parameters =
    input.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
      ? input.parameters
      : {};
  const flowId = input.flow_id != null && String(input.flow_id).trim() !== '' ? String(input.flow_id) : '';
  return {
    input: {
      mode: 'simple',
      ...(flowId ? { flowId } : {}),
      flowProps: { payload: parameters },
      waitForResponse: !asyncCall,
    },
    flowIdNote: flowId
      ? `flowId ficou o id Workato ${flowId}; trocar pelo externalId do flow no iPaaS.`
      : 'callFlow sem flow_id na Workato.',
  };
}

export function shapeReturnResponse(
  input: Record<string, any>,
  labels: Map<string, string>,
): Record<string, any> {
  const result =
    input.result && typeof input.result === 'object' && !Array.isArray(input.result) ? input.result : {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    fields[labels.get(key) ?? key] = value;
  }
  return {
    mode: 'simple',
    response: { response: fields },
  };
}

/** Schema do editor para a prop dinâmica (payload / sampleData / response). */
export function dynamicPropertySettings(
  prop: string,
  child: string,
  displayName: string,
  defaultValue?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'MANUAL',
    schema: {
      [child]: {
        type: 'OBJECT',
        required: true,
        displayName,
        ...(defaultValue ? { defaultValue } : {}),
      },
    },
  };
}
