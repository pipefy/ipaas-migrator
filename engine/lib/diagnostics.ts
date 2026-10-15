// Public diagnostics carry only categories, generated step names and counts.
// Recipe values, source aliases, custom field names and source code stay out.
import { AmbiguousMigrationMapError } from './collapse.ts';
import { InvalidWorkatoSchemaError, InvalidWorkatoSubflowInputError } from './subflow.ts';

export class InvalidCompositionInputError extends Error {
  constructor() {
    super('AP-MIGRATION-INVALID-COMPOSITION-INPUT: composicao exige componentes escalares representaveis; conversao interrompida.');
    this.name = 'InvalidCompositionInputError';
  }
}

export type MigrationDiagnosticCategory =
  | 'CODE_TRANSLATION_REQUIRED' | 'FORMULA' | 'MISSING_PROPERTY'
  | 'DATAPILL_SCHEMA' | 'MAPPING' | 'UNSUPPORTED_OPERATION' | 'MANUAL_REVIEW';

export interface MigrationDiagnostic {
  category: MigrationDiagnosticCategory;
  reason: 'UNTRANSLATED_CODE' | 'UNCOMPILED_FORMULA' | 'FORMULA_REVIEW'
    | 'MISSING_REQUIRED_PROPERTY' | 'UNRESOLVED_REFERENCE' | 'AMBIGUOUS_SOURCE' | 'INVALID_SCHEMA'
    | 'INVALID_SUBFLOW_INPUT' | 'AMBIGUOUS_MAPPING' | 'INVALID_COMPOSITION_INPUT'
    | 'UNMAPPED_OPERATION' | 'UNSUPPORTED_CHANNEL' | 'CONTROL_FLOW_UNSUPPORTED' | 'INCOMPLETE_STEP' | 'REVIEW_PENDING';
  /** SKIP_LLM skips deterministic public fixing, never the generated business step. */
  action: 'SKIP_LLM' | 'CHECK_DOCUMENTATION' | 'NEEDS_CONTEXT' | 'PRODUCT_DECISION' | 'MANUAL_REVIEW';
  stepName?: string;
  count?: number;
  severity?: 'ERROR' | 'REVIEW';
}

/** Classify known conversion failures by type, never by source/error text. */
export function diagnosticsForError(error: unknown): MigrationDiagnostic[] {
  if (error instanceof InvalidCompositionInputError) {
    return [{ category: 'MAPPING', reason: 'INVALID_COMPOSITION_INPUT', action: 'NEEDS_CONTEXT', severity: 'ERROR' }];
  }
  if (error instanceof InvalidWorkatoSchemaError) {
    return [{ category: 'DATAPILL_SCHEMA', reason: 'INVALID_SCHEMA', action: 'NEEDS_CONTEXT', severity: 'ERROR' }];
  }
  if (error instanceof InvalidWorkatoSubflowInputError) {
    return [{ category: 'DATAPILL_SCHEMA', reason: 'INVALID_SUBFLOW_INPUT', action: 'NEEDS_CONTEXT', severity: 'ERROR' }];
  }
  if (error instanceof AmbiguousMigrationMapError) {
    return [{ category: 'MAPPING', reason: 'AMBIGUOUS_MAPPING', action: 'MANUAL_REVIEW', count: error.count, severity: 'ERROR' }];
  }
  return [];
}

export function diagnosticSeverity(diagnostic: MigrationDiagnostic): 'ERROR' | 'REVIEW' {
  return diagnostic.severity ?? (diagnostic.reason === 'FORMULA_REVIEW' || diagnostic.reason === 'REVIEW_PENDING' ? 'REVIEW' : 'ERROR');
}

export function isBlockingDiagnostic(diagnostic: MigrationDiagnostic): boolean {
  return diagnosticSeverity(diagnostic) === 'ERROR';
}

export function uniqueDiagnostics(diagnostics: MigrationDiagnostic[]): MigrationDiagnostic[] {
  const normalized = diagnostics.map<MigrationDiagnostic>((diagnostic) => ({
    ...diagnostic,
    severity: diagnosticSeverity(diagnostic),
  }));
  return [...new Map(normalized.map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values()];
}
