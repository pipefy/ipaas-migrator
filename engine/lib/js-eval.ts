// js_eval Workato receives the declared fields as one object. flow-builder
// flattens code_input.data into settings.input, which AP passes to `code`.
const MAIN_ARROW_HEAD = /^exports\.main\s*=\s*(?:async\s*)?(?:\(\s*(?:\{[\s\S]*?\}|[A-Za-z_$][\w$]*)?\s*\)|[A-Za-z_$][\w$]*)\s*=>\s*/;
const MAIN_FUNCTION_HEAD = /^exports\.main\s*=\s*(?:async\s*)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*(?:\{[\s\S]*?\}|[A-Za-z_$][\w$]*)?\s*\)\s*/;

/** Adapt a standalone CommonJS main, preserving its function scope. */
export function wrapJsEvalMain(source: string): string | null {
  const trimmed = String(source ?? '').trim();
  const arrow = trimmed.match(MAIN_ARROW_HEAD);
  const head = arrow ?? trimmed.match(MAIN_FUNCTION_HEAD);
  if (!head) return null;
  const rest = trimmed.slice(head[0].length).replace(/;?\s*$/, '');
  if (!rest) return null;
  if (!arrow && !rest.startsWith('{')) return null;
  if (rest.startsWith('{') && (!rest.endsWith('}') || !rest.slice(1, -1).trim())) return null;

  // Keep destructuring/defaults/body inside main: a field named `inputs` must
  // not redeclare the AP wrapper parameter, and async rejections must propagate.
  const main = trimmed.replace(/^exports\.main\s*=\s*/, '').replace(/;?\s*$/, '');
  return [
    'export const code = async (inputs) => {',
    `  const main = ${main};`,
    '  return await main(inputs);',
    '};',
  ].join('\n');
}
