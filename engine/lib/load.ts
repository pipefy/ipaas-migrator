// Carrega config, KB e mapas (base + user), e faz o merge.
export { collapseOpKey, collapseProvider, lookupMap } from './collapse.ts';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kb, MapEntry, MapFile, SlimPiece } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..', '..'); // workato_migrator_helper

export interface Config {
  instance: string;
  apVersion: string;
  paths: { kb: string; baseMap: string; userMap: string; output: string };
}

export async function loadConfig(): Promise<Config> {
  return JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8')) as Config;
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, 'utf8')) as T;
}

export async function loadKb(cfg: Config): Promise<{ kb: Kb; index: Map<string, SlimPiece> }> {
  const kb = await readJson<Kb>(join(ROOT, cfg.paths.kb));
  const index = new Map<string, SlimPiece>();
  for (const p of kb.pieces) index.set(p.name, p);
  return { kb, index };
}

/** Merge base + user (user vence). Marca a origem de cada entrada. */
export async function loadMergedMap(cfg: Config): Promise<{
  merged: Record<string, MapEntry>;
  base: MapFile;
  user: MapFile;
}> {
  const base = await readJson<MapFile>(join(ROOT, cfg.paths.baseMap));
  const userPath = join(ROOT, cfg.paths.userMap);
  const user: MapFile = existsSync(userPath)
    ? await readJson<MapFile>(userPath)
    : { version: 1, operations: {} };

  const merged: Record<string, MapEntry> = {};
  for (const [k, v] of Object.entries(base.operations ?? {})) merged[k] = { ...v, source: 'base' };
  for (const [k, v] of Object.entries(user.operations ?? {})) merged[k] = { ...v, source: 'user' };
  return { merged, base, user };
}

export function userMapPath(cfg: Config): string {
  return join(ROOT, cfg.paths.userMap);
}
export function outputDir(cfg: Config): string {
  return join(ROOT, cfg.paths.output);
}
