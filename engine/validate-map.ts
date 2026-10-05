// Valida mappings/base-map.json + user-map.json contra a KB.
// Uso: npm run validate:map
import { loadConfig, loadKb, loadMergedMap } from './lib/load.ts';
import type { MapEntry, MapTarget, SlimPiece } from './lib/types.ts';

function checkTarget(
  label: string,
  target: MapTarget,
  index: Map<string, SlimPiece>,
): string[] {
  const errs: string[] = [];
  const piece = index.get(target.piece);
  if (!piece) {
    errs.push(`${label}: piece "${target.piece}" nao existe na KB`);
    return errs;
  }
  const pool = target.kind === 'trigger' ? piece.triggers : piece.actions;
  const op = pool.find((x) => x.name === target.name);
  if (!op) {
    const names = pool.map((x) => x.name).join(', ') || '(vazio)';
    errs.push(`${label}: ${target.kind} "${target.name}" nao existe em ${target.piece}. Validas: ${names}`);
  }
  return errs;
}

function validPropNames(target: MapTarget, index: Map<string, SlimPiece>): Set<string> {
  const piece = index.get(target.piece);
  const pool = target.kind === 'trigger' ? piece?.triggers : piece?.actions;
  const op = pool?.find((x) => x.name === target.name);
  return new Set((op?.props ?? []).map((p) => p.name));
}

function checkEntry(opKey: string, entry: MapEntry, index: Map<string, SlimPiece>): string[] {
  const errs: string[] = [];
  if (entry.target) {
    errs.push(...checkTarget(`${opKey}.target`, entry.target, index));
    if (entry.propMap && index.has(entry.target.piece)) {
      const valid = validPropNames(entry.target, index);
      for (const apProp of Object.values(entry.propMap)) {
        if (!valid.has(apProp)) {
          errs.push(`${opKey}: propMap alvo "${apProp}" nao existe em ${entry.target.piece}/${entry.target.name}`);
        }
      }
    }
    if (entry.collectRemainingTo && index.has(entry.target.piece)) {
      const valid = validPropNames(entry.target, index);
      if (!valid.has(entry.collectRemainingTo)) {
        errs.push(`${opKey}: collectRemainingTo "${entry.collectRemainingTo}" nao existe em ${entry.target.piece}/${entry.target.name}`);
      }
    }
    if (entry.composeProps && index.has(entry.target.piece)) {
      const valid = validPropNames(entry.target, index);
      for (const apProp of Object.keys(entry.composeProps)) {
        if (!valid.has(apProp)) {
          errs.push(`${opKey}: composeProps "${apProp}" nao existe em ${entry.target.piece}/${entry.target.name}`);
        }
      }
    }
    if (entry.fixedProps && index.has(entry.target.piece)) {
      const valid = validPropNames(entry.target, index);
      for (const apProp of Object.keys(entry.fixedProps)) {
        if (!valid.has(apProp)) {
          errs.push(`${opKey}: fixedProps "${apProp}" nao existe em ${entry.target.piece}/${entry.target.name}`);
        }
      }
    }
  } else if (!entry.builtin && !entry.manual) {
    errs.push(`${opKey}: sem target, builtin ou manual`);
  }

  const alt = entry.alt as MapTarget | undefined;
  if (alt && alt.piece && alt.name) {
    errs.push(...checkTarget(`${opKey}.alt`, { piece: alt.piece, name: alt.name, kind: alt.kind ?? 'action' }, index));
  }
  return errs;
}

async function main(): Promise<void> {
  const cfg = await loadConfig();
  const { kb, index } = await loadKb(cfg);
  const { merged, base, user } = await loadMergedMap(cfg);
  const errors: string[] = [];

  for (const [opKey, entry] of Object.entries(merged)) {
    errors.push(...checkEntry(opKey, entry, index));
  }

  console.log(`KB: ${kb.pieces.length} pieces | mapas: ${Object.keys(base.operations).length} base + ${Object.keys(user.operations).length} user`);
  if (errors.length) {
    console.error(`\n${errors.length} erro(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('OK: todos os alvos e props do mapa existem na KB.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
