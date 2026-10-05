// Tipos compartilhados pelos scripts da migracao.

export interface SlimProp { name: string; required: boolean; type?: string }
export interface SlimOp { name: string; props: SlimProp[] }
export interface SlimPiece {
  name: string;
  displayName: string;
  version: string;
  isCustom: boolean;
  auth: string | null;
  categories: string[];
  actions: SlimOp[];
  triggers: SlimOp[];
}
export interface Kb { pieces: SlimPiece[] }

export interface MapTarget {
  piece: string;
  name: string;
  kind: 'action' | 'trigger';
}
export interface MapEntry {
  target: MapTarget | null;
  alt?: unknown;
  builtin?: string; // 'code' | 'router' | 'loop'
  propMap?: Record<string, string>;
  fixedProps?: Record<string, unknown>;
  /** Prop AP = concatenacao de varias props Workato (ex.: path = folder_path + "/" + filename). */
  composeProps?: Record<string, { parts: string[]; separator?: string }>;
  collectRemainingTo?: string;
  ignoreSourceProps?: string[];
  difficulty?: 'low' | 'medium' | 'high';
  manual?: boolean;
  notes?: string;
  source?: 'base' | 'user'; // preenchido no merge
}
export interface MapFile {
  version: number;
  operations: Record<string, MapEntry>;
  controlFlow?: Record<string, string>;
  builtins?: Record<string, unknown>;
}

export interface WorkatoCondition {
  lhs?: unknown;
  operand?: string;
  rhs?: unknown;
}

/** `input` de `if`/`elsif`/`while_condition` e o `filter` do trigger. */
export interface WorkatoConditionsInput {
  conditions?: WorkatoCondition[];
  /** `and` (default) or `or`. */
  operand?: string;
}

// ---- Receita Workato parseada ----
export interface ParsedStep {
  number?: number;
  as?: string;
  provider?: string;
  name?: string; // operacao
  keyword: string; // trigger|action|if|elsif|else|foreach|repeat|while_condition|comment|try|catch|stop
  /** `skip: true` na receita: passo desativado, nao executa. */
  skip?: boolean;
  input: Record<string, any>;
  /**
   * Trigger only: condition deciding whether the job runs. Ignoring it makes
   * the flow fire on every event, not only the filtered ones.
   */
  filter?: WorkatoConditionsInput;
  /** Workato foreach: pill da lista (ex. phases_history). */
  source?: string;
  comment?: string;
  children: ParsedStep[];
  opKey?: string; // 'provider/name' quando aplicavel
  /**
   * Rótulo do dropdown de fase (`dynamicPickListSelection.phase_id`).
   * O input guarda `0` para o formulário inicial; o id real está no schema.
   */
  phasePickLabel?: string;
  /** Campos do `extended_input_schema` (nome, rótulo, tipo). */
  inputFields?: WorkatoInputField[];
  /** Nome do step no flow AP, atribuido no pre-pass. */
  apName?: string;
  /**
   * Variaveis Workato `linear` vigentes quando este passo le os proprios
   * inputs: `as` do declare -> nome do step AP que carrega o valor atual.
   * Sem isso, a leitura apontaria sempre para o declare e perderia os updates.
   */
  varSnapshot?: Map<string, string>;
}
/** Campo dinâmico do conector Workato, usado para desenhar phaseFields/startFormFields. */
export interface WorkatoInputField {
  name: string;
  label?: string;
  controlType?: string;
  optional?: boolean;
}

export interface FormulaHit {
  raw: string;
  rubyMethods: string[];
  needsCode: boolean;
}
export interface ParsedRecipe {
  file: string;
  name: string;
  /** Id da receita na Workato, quando o JSON traz `id`. */
  workatoId?: string;
  description?: string;
  root: ParsedStep; // trigger
  connections: string[];
  /** Provider Workato -> rótulo da conexão (`account_id`) usada pela receita. */
  connectionsByProvider?: Record<string, string>;
  opCounts: Record<string, number>; // opKey -> count
  formulas: FormulaHit[];
  hasRuby: boolean;
  stepCount: number;
  /**
   * Fases lidas de `fields_by_phase` nos schemas de saída, agrupadas pelo
   * `pipe_id` do passo que trouxe o schema.
   */
  phasesByPipe?: PipePhase[];
}

/** Fase Pipefy vista no schema Workato: rótulo do dropdown → id numérico. */
export interface PipePhase {
  pipeId: string;
  label: string;
  phaseId: string;
}

export interface OpClassification {
  opKey: string;
  count: number;
  status: 'mapped' | 'builtin' | 'manual' | 'unmapped';
  target?: MapTarget | null;
  builtin?: string;
  difficulty?: string;
  notes?: string;
  suggestions?: { piece: string; op: string; kind: 'action' | 'trigger'; score: number }[];
}
