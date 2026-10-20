// Recipe function da Workato → piece-subflows em mode simple.
// O gabarito (subflows 0.7.0) exige mode; sem ele o step fica inválido.
// flowId do callFlow é o externalId do flow no iPaaS. Aqui só cabe o id Workato.

export const SUBFLOW_PIECE_VERSION = '0.7.0';

export interface SchemaField {
  name?: string;
  label?: string;
  type?: string;
  of?: string;
  properties?: SchemaField[];
}

const INVALID_SCHEMA = 'AP-MIGRATION-INVALID-SCHEMA: schema de subflow invalido ou sem estrutura suportada.';
export class InvalidWorkatoSchemaError extends Error {
  constructor() { super(INVALID_SCHEMA); }
}
export class InvalidWorkatoSubflowInputError extends Error {
  constructor() {
    super('AP-MIGRATION-INVALID-SUBFLOW-INPUT: campos de subflow devem formar um objeto; conversao interrompida.');
  }
}
const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'date', 'date_time', 'timestamp']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function subflowFields(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new InvalidWorkatoSubflowInputError();
  return raw;
}

function schemaFields(raw: unknown): SchemaField[] {
  if (!Array.isArray(raw)) throw new InvalidWorkatoSchemaError();
  const names = new Set<string>();
  return raw.map((field) => {
    if (!isRecord(field) || typeof field.name !== 'string' || !field.name.trim() || names.has(field.name)) {
      throw new InvalidWorkatoSchemaError();
    }
    names.add(field.name);
    if (field.type !== undefined && typeof field.type !== 'string') throw new InvalidWorkatoSchemaError();
    if (field.label !== undefined && typeof field.label !== 'string') throw new InvalidWorkatoSchemaError();
    if (field.of !== undefined && typeof field.of !== 'string') throw new InvalidWorkatoSchemaError();
    const type = String(field.type ?? 'string').toLowerCase();
    const of = typeof field.of === 'string' ? field.of.toLowerCase() : undefined;
    if (!SCALAR_TYPES.has(type) && type !== 'object' && type !== 'array') throw new InvalidWorkatoSchemaError();
    if (type === 'array' && (!of || (!SCALAR_TYPES.has(of) && of !== 'object'))) throw new InvalidWorkatoSchemaError();
    const properties = field.properties === undefined ? undefined : schemaFields(field.properties);
    if ((type === 'object' || (type === 'array' && of === 'object')) && !properties) throw new InvalidWorkatoSchemaError();
    return {
      ...field,
      name: field.name,
      ...(field.type !== undefined ? { type } : {}),
      ...(of !== undefined ? { of } : {}),
      ...(properties !== undefined ? { properties } : {}),
    };
  });
}

export function parseWorkatoSchema(raw: unknown): SchemaField[] {
  if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) return [];
  try {
    return schemaFields(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    // Nao transporte o payload nem a mensagem do parser JSON para diagnosticos.
    throw new InvalidWorkatoSchemaError();
  }
}

function sampleFor(field: SchemaField): unknown {
  switch (field.type ?? 'string') {
    case 'object':
      if (!field.properties) throw new InvalidWorkatoSchemaError();
      return sampleFields(field.properties);
    case 'array':
      if (!field.of) throw new InvalidWorkatoSchemaError();
      return [sampleFor({ ...field, type: field.of })];
    case 'boolean': return true;
    case 'integer': return 1;
    case 'number': return 1.25;
    case 'date': return '2000-01-01';
    case 'date_time':
    case 'timestamp': return '2000-01-01T00:00:00Z';
    default: return '1234';
  }
}

function sampleFields(fields: SchemaField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => {
    if (!field.name) throw new InvalidWorkatoSchemaError();
    return [field.name, sampleFor(field)];
  }));
}

/** Dados ficticios de tipagem do editor; nao sao defaults de negocio. */
export function sampleDataFromSchema(raw: unknown): Record<string, unknown> {
  return sampleFields(parseWorkatoSchema(raw));
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
    exampleData: {
      sampleData: sampleDataFromSchema(input.parameters_schema_json ?? input.request_schema_json),
    },
  };
}

export function shapeCallFlow(
  input: Record<string, any>,
  asyncCall: boolean,
): { input: Record<string, any>; flowIdNote: string | null } {
  const parameters = subflowFields(input.parameters);
  const flowId = input.flow_id != null && String(input.flow_id).trim() !== '' ? String(input.flow_id) : '';
  return {
    input: {
      mode: 'simple',
      ...(flowId ? { flowId } : {}),
      flowProps: { payload: parameters },
      waitForResponse: !asyncCall,
    },
    flowIdNote: flowId
      ? 'flowId usa o identificador de origem; trocar pelo externalId do flow no iPaaS.'
      : 'callFlow sem flow_id na Workato.',
  };
}

export function shapeReturnResponse(
  input: Record<string, any>,
  _labels: Map<string, string>,
): Record<string, any> {
  const result = subflowFields(input.result);
  // Labels pertencem a apresentacao. Os nomes do schema identificam os dados.
  const fields = Object.fromEntries(Object.entries(result));
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
