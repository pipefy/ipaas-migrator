// piece-pipefy das próximas traduções. A KB continua no snapshot 0.1.9;
// o destino (Invenergy ST) tem 0.2.4, e o input de leitura de card ganhou
// as listas de campo. Valores copiados do gabarito Offshore (schema 23).

export const PIPEFY_PIECE_VERSION = '0.2.4';

const CARD_READ_ACTIONS = new Set(['getCardById', 'getCardsByFieldValue']);

export const PIPEFY_CARD_FIELDS: Record<string, string[]> = {
  comments: ['id', 'text', 'created_at', 'author_name'],
  assignees: ['name', 'email', 'id', 'locale', 'timezone'],
  card_info: [
    'uuid',
    'suid',
    'age',
    'title',
    'comments_count',
    'createdAt',
    'current_phase_age',
    'done',
    'due_date',
    'emailMessagingAddress',
    'expired',
    'late',
    'started_current_phase_at',
    'updated_at',
    'url',
    'creatorEmail',
    'current_phase',
  ],
  created_by: ['email', 'id', 'locale', 'name', 'timezone'],
  attachments: ['createdAt', 'createdBy', 'field', 'path', 'phase', 'url'],
  inbox_emails: [
    'bcc',
    'body',
    'cc',
    'from',
    'fromName',
    'id',
    'main_to',
    'message_id',
    'sent_via_automation',
    'state',
    'subject',
    'to',
    'updated_at',
    'user',
    'attachments',
  ],
  phases_history: ['duration', 'phase', 'firstTimeIn', 'lastTimeIn', 'lastTimeOut', 'created_at', 'became_late'],
  child_relations: ['name', 'pipe', 'repo', 'cards'],
  parent_relations: ['name', 'pipe', 'repo', 'cards'],
};

export interface UpdateListFieldAdd {
  nodeId: string;
  fieldId: string;
  fieldValue: string;
  operation: 'ADD';
}

function graphqlQuery(input: Record<string, any>): string | null {
  const body = input?.body;
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return null;
  if (typeof body.query === 'string') return body.query;
  if (typeof body.data === 'string') return body.data;
  if (body.data && typeof body.data === 'object' && typeof body.data.query === 'string') return body.data.query;
  return null;
}

/**
 * custom_api_call com `updateFieldsValues` e um único `operation: ADD`
 * vira updateListField. Vários campos na mesma mutation ficam no GraphQL.
 */
export function updateListFieldFromGraphql(input: Record<string, any>): UpdateListFieldAdd | null {
  const query = graphqlQuery(input);
  if (!query || !/updateFieldsValues/i.test(query)) return null;
  const fields = [...query.matchAll(/fieldId:/g)];
  if (fields.length !== 1) return null;
  const node = query.match(/nodeId:\s*(\{\{[\s\S]*?\}\}|[^,\s]+)/);
  const item = query.match(
    /fieldId:\s*"([^"]+)"\s*,?\s*value:\s*(?:"([\s\S]*?)"|(\{\{[\s\S]*?\}\}))\s*,?\s*operation:\s*"?ADD"?\b/,
  );
  if (!node || !item) return null;
  return {
    nodeId: node[1]!.trim(),
    fieldId: item[1]!,
    fieldValue: (item[2] ?? item[3])!,
    operation: 'ADD',
  };
}

const DYNAMIC_FIELD_PROPS = ['phaseFields', 'startFormFields'] as const;

function fieldPropertyType(controlType: string | undefined): string {
  const control = (controlType ?? '').toLowerCase();
  if (control === 'text-area' || control === 'text_area') return 'LONG_TEXT';
  if (control === 'number' || control === 'integer') return 'NUMBER';
  if (control === 'checkbox') return 'CHECKBOX';
  return 'SHORT_TEXT';
}

/**
 * O canvas só desenha phaseFields/startFormFields se o schema estiver em
 * propertySettings. A chave é o id do campo no Pipefy (o slug, ex. request_identifier).
 */
export function pipefyPropertySettings(
  input: Record<string, any>,
  fields: { name: string; label?: string; controlType?: string; optional?: boolean }[] | undefined,
): Record<string, any> {
  const settings: Record<string, any> = {};
  for (const key of Object.keys(input)) settings[key] = { type: 'MANUAL' };
  for (const prop of DYNAMIC_FIELD_PROPS) {
    const value = input[prop];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const schema: Record<string, unknown> = {};
    for (const fieldKey of Object.keys(value)) {
      const def = fields?.find((field) => field.name === fieldKey);
      schema[fieldKey] = {
        displayName: def?.label?.trim() || fieldKey,
        required: def?.optional === false,
        type: fieldPropertyType(def?.controlType),
      };
    }
    if (Object.keys(schema).length) settings[prop] = { type: 'MANUAL', schema };
  }
  return settings;
}

export function withPipefyCardFields(actionName: string, input: Record<string, any>): Record<string, any> {
  if (!CARD_READ_ACTIONS.has(actionName)) return input;
  const fields: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(PIPEFY_CARD_FIELDS)) fields[key] = [...values];
  return { ...input, ...fields };
}
