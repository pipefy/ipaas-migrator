// Gera Mermaid da arvore `code` de 1+ receitas Workato. NAO transpila.
//
// Uso: npm run diagram -- <caminho.json|.zip|pasta> [--stdout]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, outputDir } from './lib/load.ts';
import { ingest } from './lib/ingest.ts';
import { parseRecipe } from './lib/parse-recipe.ts';
import { toMermaid } from './lib/diagram.ts';

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) {
    console.error('ERRO: informe o caminho do export (.json, .zip ou pasta).');
    process.exit(1);
  }
  const stdoutOnly = process.argv.includes('--stdout');
  const cfg = await loadConfig();
  const items = await ingest(input);
  if (items.length === 0) {
    console.error('ERRO: nenhuma receita Workato encontrada (campo code ausente).');
    process.exit(1);
  }

  const out = outputDir(cfg);
  if (!stdoutOnly) await mkdir(out, { recursive: true });

  for (const it of items) {
    const recipe = parseRecipe(it.json, it.file);
    const mermaid = toMermaid(recipe);
    if (stdoutOnly) {
      process.stdout.write(mermaid);
      if (items.length > 1) process.stdout.write('\n');
      continue;
    }
    const base = it.file.replace(/\.recipe\.json$|\.json$/i, '');
    const dest = join(out, `${base}.mmd`);
    await writeFile(dest, mermaid, 'utf8');
    console.log(`${recipe.name} → ${dest}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
