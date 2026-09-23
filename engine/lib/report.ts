// Geracao de relatorios legiveis (Markdown) para pessoas nao tecnicas.
import type { OpClassification, ParsedRecipe } from './types.ts';

const ICON = { mapped: '✅', builtin: '⚙️', manual: '🔴', unmapped: '❓' } as const;

export function analysisMarkdown(
  recipe: ParsedRecipe,
  ops: OpClassification[],
): string {
  const L: string[] = [];
  L.push(`# Análise da receita: ${recipe.name}`);
  L.push('');
  L.push(`- Arquivo: \`${recipe.file}\``);
  L.push(`- Passos: ${recipe.stepCount}`);
  L.push(`- Conexões usadas: ${recipe.connections.join(', ') || '—'}`);
  L.push(`- Fórmulas detectadas: ${recipe.formulas.length} (com código Ruby: ${recipe.formulas.filter((f) => f.needsCode).length})`);
  L.push('');

  const counts = {
    mapped: ops.filter((o) => o.status === 'mapped').length,
    builtin: ops.filter((o) => o.status === 'builtin').length,
    manual: ops.filter((o) => o.status === 'manual').length,
    unmapped: ops.filter((o) => o.status === 'unmapped').length,
  };
  L.push('## Resumo');
  L.push(`- ✅ Mapeadas: ${counts.mapped}`);
  L.push(`- ⚙️ Nativas (código/loop/router): ${counts.builtin}`);
  L.push(`- 🔴 Precisam de reescrita manual (Ruby): ${counts.manual}`);
  L.push(`- ❓ Ainda não mapeadas: ${counts.unmapped}`);
  L.push('');

  L.push('## Operações usadas');
  L.push('| Status | Operação (Workato) | Qtd | Destino (Activepieces) |');
  L.push('|:--:|---|--:|---|');
  for (const o of ops) {
    const dest =
      o.status === 'mapped'
        ? `${o.target?.piece} → ${o.target?.name}`
        : o.status === 'builtin'
          ? `built-in: ${o.builtin}`
          : o.status === 'manual'
            ? 'step CODE (JS) — revisão humana'
            : '**definir** (ver sugestões)';
    L.push(`| ${ICON[o.status]} | \`${o.opKey}\` | ${o.count} | ${dest} |`);
  }
  L.push('');

  const unmapped = ops.filter((o) => o.status === 'unmapped');
  if (unmapped.length) {
    L.push('## ❓ Operações não mapeadas — precisam da sua definição');
    for (const o of unmapped) {
      L.push(`\n### \`${o.opKey}\``);
      if (o.suggestions?.length) {
        L.push('Sugestões (melhor palpite primeiro):');
        for (const s of o.suggestions) {
          L.push(`- \`${s.piece}\` → \`${s.op}\` (${s.kind})`);
        }
      } else {
        L.push('Sem sugestão automática — avaliar manualmente na KB.');
      }
    }
    L.push('');
  }

  if (recipe.formulas.some((f) => f.needsCode)) {
    L.push('## 🔴 Fórmulas com código Ruby (viram step CODE)');
    for (const f of recipe.formulas.filter((x) => x.needsCode).slice(0, 20)) {
      L.push(`- \`${f.raw.slice(0, 120)}\` — métodos: ${f.rubyMethods.join(', ')}`);
    }
    L.push('');
  }

  return L.join('\n');
}
