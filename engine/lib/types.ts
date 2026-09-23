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
  /** Nome do step no flow AP, atribuido no pre-pass. */
  apName?: string;
  /**
   * Variaveis Workato `linear` vigentes quando este passo le os proprios
   * inputs: `as` do declare -> nome do step AP que carrega o valor atual.
   * Sem isso, a leitura apontaria sempre para o declare e perderia os updates.
   */
  varSnapshot?: Map<string, string>;
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
  opCounts: Record<string, number>; // opKey -> count
  formulas: FormulaHit[];
  hasRuby: boolean;
  stepCount: number;
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
