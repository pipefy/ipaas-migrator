// Lista os mapas disponiveis: padroes da skill (base) + definidos pelo usuario.
// Uso: npm run maps  [-- --json]
import { loadConfig, loadMergedMap } from './lib/load.ts';

async function main(): Promise<void> {
  const cfg = await loadConfig();
  const { merged, base, user } = await loadMergedMap(cfg);
  const asJson = process.argv.includes('--json');

  if (asJson) {
    console.log(JSON.stringify({ merged, baseCount: Object.keys(base.operations).length, userCount: Object.keys(user.operations).length }, null, 2));
    return;
  }

  const entries = Object.entries(merged).sort((a, b) => a[0].localeCompare(b[0]));
  console.log('=== Mapas de conversão Workato → Activepieces ===');
  console.log(`Padrões da skill: ${Object.keys(base.operations).length} | Definidos por você: ${Object.keys(user.operations).length}`);
  console.log('');
  console.log('ORIGEM | OPERAÇÃO (Workato) → DESTINO (Activepieces)');
  for (const [op, e] of entries) {
    const origin = e.source === 'user' ? '👤 você ' : '📦 skill';
    const dest = e.target
      ? `${e.target.piece} / ${e.target.name} (${e.target.kind})`
      : e.builtin
        ? `built-in: ${e.builtin}`
        : e.manual
          ? 'CODE (manual)'
          : '—';
    console.log(`${origin} | ${op}  →  ${dest}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
