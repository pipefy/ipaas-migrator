// Transpila 1+ receitas Workato -> flow Activepieces (DRAFT) + relatorio.
// Bloqueia se houver operacao nao mapeada (a menos que --force).
//
// Uso: tsx engine/transpile.ts <caminho.json|.zip|pasta> [--out pasta] [--force]

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig, loadKb, loadMergedMap, outputDir } from './lib/load.ts';
import { ingest } from './lib/ingest.ts';
import { parseRecipe } from './lib/parse-recipe.ts';
import { classifyOps } from './lib/classify.ts';
import { buildFlow } from './lib/flow-builder.ts';

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) {
    console.error('ERRO: informe o caminho do export (.json, .zip ou pasta).');
    process.exit(1);
  }
  const force = process.argv.includes('--force');
  const outputIndex = process.argv.indexOf('--out');
  const explicitOutput = outputIndex < 0 ? undefined : process.argv[outputIndex + 1];
  if (outputIndex >= 0 && (!explicitOutput || explicitOutput.startsWith('--'))) {
    console.error('ERRO: --out exige uma pasta de saida.');
    process.exit(1);
  }
  const cfg = await loadConfig();
  const { kb } = await loadKb(cfg);
  const { merged } = await loadMergedMap(cfg);
  const items = await ingest(input);
  const out = explicitOutput ? resolve(explicitOutput) : outputDir(cfg);
  await mkdir(out, { recursive: true });

  let blocked = 0;
  for (const it of items) {
    const recipe = parseRecipe(it.json, it.file);
    const ops = classifyOps(recipe.opCounts, merged, kb);
    const unmapped = ops.filter((o) => o.status === 'unmapped');
    const baseName = it.file.replace(/\.recipe\.json$|\.json$/i, '');

    if (unmapped.length && !force) {
      blocked++;
      console.log(`⛔ ${recipe.name}: ${unmapped.length} operação(ões) não mapeada(s) — pulei.`);
      for (const u of unmapped) console.log(`     ❓ ${u.opKey}`);
      continue;
    }

    const { flow, todos, diagnostics } = buildFlow(recipe, merged, kb);
    const incomplete = todos.length > 0 || flow.flows.some((entry: any) => entry.valid !== true);
    if (incomplete) blocked++;
    await writeFile(join(out, `${baseName}.flow.json`), JSON.stringify(flow, null, 2), 'utf8');
    await writeFile(join(out, `${baseName}.diagnostics.json`), JSON.stringify(diagnostics, null, 2), 'utf8');

    const report = [
      `# Migração: ${recipe.name}`,
      '',
      `- Origem: \`${it.file}\``,
      `- Saída: \`${baseName}.flow.json\``,
      `- Status: ${todos.length ? '⚠️ precisa de ajustes manuais' : '✅ pronto (revisar e importar)'}`,
      '',
      '## Conexões a recriar no Activepieces',
      ...recipe.connections.map((c) => `- ${c}`),
      '',
      '## Pontos que precisam de revisão humana',
      ...(todos.length ? todos.map((t) => `- ${t}`) : ['- Nenhum. 🎉']),
      '',
      '> ⚠️ O `flow.json` é um RASCUNHO. Confirme o schema de import com um flow Activepieces exportado real antes de importar em produção.',
    ].join('\n');
    await writeFile(join(out, `${baseName}.report.md`), report, 'utf8');

    console.log(`${incomplete ? '⚠️' : '✅'} ${recipe.name} → ${baseName}.flow.json ${incomplete ? `(rascunho incompleto; ${todos.length} pendencias)` : ''}`);
  }

  console.log(`\nArquivos em: ${out}`);
  if (blocked) {
    console.log(`\n⚠️ ${blocked} receita(s) incompleta(s) ou bloqueada(s). Revise os mapas e os relatorios; --force permite rascunho, mas nao comprova a conversao.`);
    process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
