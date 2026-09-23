// Analisa 1+ receitas Workato (json/zip/pasta): classifica operacoes, detecta
// nao-mapeadas e formulas Ruby. NAO gera flow. Salva analise em output/.
//
// Uso: npm run analyze -- <caminho.json|.zip|pasta> [--json]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, loadKb, loadMergedMap, outputDir } from './lib/load.ts';
import { ingest } from './lib/ingest.ts';
import { parseRecipe } from './lib/parse-recipe.ts';
import { classifyOps } from './lib/classify.ts';
import { analysisMarkdown } from './lib/report.ts';

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) {
    console.error('ERRO: informe o caminho do export (.json, .zip ou pasta).');
    process.exit(1);
  }
  const cfg = await loadConfig();
  const { kb } = await loadKb(cfg);
  const { merged } = await loadMergedMap(cfg);
  const items = await ingest(input);
  const out = outputDir(cfg);
  await mkdir(out, { recursive: true });

  const summary: any[] = [];
  for (const it of items) {
    const recipe = parseRecipe(it.json, it.file);
    const ops = classifyOps(recipe.opCounts, merged, kb);
    const md = analysisMarkdown(recipe, ops);
    const base = it.file.replace(/\.recipe\.json$|\.json$/i, '');
    await writeFile(join(out, `${base}.analysis.md`), md, 'utf8');

    const unmapped = ops.filter((o) => o.status === 'unmapped');
    summary.push({
      file: it.file,
      name: recipe.name,
      steps: recipe.stepCount,
      mapped: ops.filter((o) => o.status === 'mapped').length,
      builtin: ops.filter((o) => o.status === 'builtin').length,
      manual: ops.filter((o) => o.status === 'manual').length,
      unmapped: unmapped.map((o) => o.opKey),
      hasRuby: recipe.hasRuby,
    });
  }

  await writeFile(join(out, 'analysis-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`=== Análise: ${items.length} receita(s) ===\n`);
  for (const s of summary) {
    const flag = s.unmapped.length ? '❓' : s.manual ? '🔴' : '✅';
    console.log(`${flag} ${s.name}`);
    console.log(`   passos ${s.steps} | mapeadas ${s.mapped} | nativas ${s.builtin} | manual(Ruby) ${s.manual} | não mapeadas ${s.unmapped.length}`);
    if (s.unmapped.length) console.log(`   ❓ definir: ${s.unmapped.join(', ')}`);
  }
  const allUnmapped = [...new Set(summary.flatMap((s) => s.unmapped))];
  console.log(`\nRelatórios em: ${out}`);
  if (allUnmapped.length) {
    console.log(`\n⚠️ ${allUnmapped.length} operação(ões) não mapeada(s) no total. Defina os mapas antes de migrar:`);
    for (const u of allUnmapped) console.log(`   - ${u}`);
  } else {
    console.log('\n✅ Tudo mapeado. Pronto para migrar.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
