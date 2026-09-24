// js_eval da Workato já é JavaScript (`exports.main`). O step CODE do AP
// lê o mesmo payload em `inputs.code_input.data` e exporta `code`.

const MAIN_HEAD = /^exports\.main\s*=\s*async\s*\(\s*\{([\s\S]*?)\}\s*\)\s*=>\s*/;

function compactParams(raw: string): string {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** Converte `exports.main = async ({ a, b }) => …` em `export const code`. */
export function wrapJsEvalMain(source: string): string | null {
  const trimmed = String(source ?? '').trim();
  const head = trimmed.match(MAIN_HEAD);
  if (!head) return null;
  const params = compactParams(head[1] ?? '');
  const rest = trimmed.slice(head[0].length).replace(/;?\s*$/, '');
  if (!rest) return null;

  const dest = params ? `  const { ${params} } = inputs.code_input.data;` : '';
  let inner: string;
  if (rest.startsWith('{')) {
    if (!rest.endsWith('}')) return null;
    inner = rest.slice(1, -1).replace(/^\n/, '').replace(/\s+$/, '');
  } else {
    inner = `  return (${rest});`;
  }
  if (!inner.trim()) return null;

  return ['export const code = async (inputs) => {', dest, inner, '};']
    .filter((line) => line !== '')
    .join('\n');
}
