// Copia a skill do kit cliente para Cursor / Claude / Codex.
// Nao instala as skills internas (pipe Migração Workato).
//
//   node scripts/instalar-cliente.mjs
//   node scripts/instalar-cliente.mjs --navegador

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_SEM = 'migrador-workato-cliente';
const SKILL_NAV = 'migrador-workato-cliente-navegador';
const SKILL_DEPS = 'migrador-workato-sem-dependencia';

function flag(name) {
  return process.argv.includes(name);
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

function detectSkill(root) {
  const nav = join(root, '.cursor', 'skills', SKILL_NAV, 'SKILL.md');
  const sem = join(root, '.cursor', 'skills', SKILL_SEM, 'SKILL.md');
  if (existsSync(nav)) return SKILL_NAV;
  if (existsSync(join(root, 'VARIANT'))) {
    const v = readFileSync(join(root, 'VARIANT'), 'utf8').trim();
    if (v === 'sem' && existsSync(sem)) return SKILL_SEM;
  }
  if (existsSync(sem)) return SKILL_SEM;
  return SKILL_NAV;
}

function findRoot(from) {
  let dir = resolve(from);
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(join(dir, 'engine', 'run.ts')) &&
      (existsSync(join(dir, '.cursor', 'skills', SKILL_SEM, 'SKILL.md')) ||
        existsSync(join(dir, '.cursor', 'skills', SKILL_NAV, 'SKILL.md')))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function dests(hosts) {
  const home = homedir();
  const list = [];
  if (hosts.includes('cursor')) list.push({ host: 'cursor', path: join(home, '.cursor', 'skills') });
  if (hosts.includes('claude')) list.push({ host: 'claude', path: join(home, '.claude', 'skills') });
  if (hosts.includes('codex')) {
    const codexHome = process.env.CODEX_HOME ?? join(home, '.codex');
    list.push({ host: 'codex', path: join(codexHome, 'skills') });
    list.push({ host: 'agents', path: join(home, '.agents', 'skills') });
  }
  return list.filter((d) => !d.path.includes('/.cursor/skills-cursor') && !d.path.includes('/.system/'));
}

function openaiYaml(skill) {
  const nav = skill === SKILL_NAV;
  return [
    'interface:',
    nav
      ? '  display_name: "Migrador Workato (cliente, com navegador)"'
      : '  display_name: "Migrador Workato (cliente)"',
    nav
      ? '  short_description: "Tutor 0.6.5: atualiza antes de traduzir, API ou JSON, conexao e Downloads"'
      : '  short_description: "Tutor: idioma, chave ou JSON, traduz, guia o Import"',
    nav
      ? '  default_prompt: "Instale o migrador com navegador e vamos migrar a receita."'
      : '  default_prompt: "Instale o migrador e vamos migrar a receita."',
    'policy:',
    '  allow_implicit_invocation: false',
    '',
  ].join('\n');
}

function main() {
  const root = resolve(arg('--root') ?? findRoot(dirname(fileURLToPath(import.meta.url))) ?? findRoot(process.cwd()) ?? '');
  const skill = detectSkill(root);
  const src = join(root, '.cursor', 'skills', skill);
  if (!existsSync(join(src, 'SKILL.md'))) {
    console.error(`skill ausente: ${src}`);
    process.exit(1);
  }
  const hosts = String(arg('--hosts', 'cursor,claude,codex'))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const dry = flag('--dry-run');
  const written = [];
  for (const dest of dests(hosts.length ? hosts : ['cursor', 'claude', 'codex'])) {
    const target = join(dest.path, skill);
    if (!dry) {
      mkdirSync(dest.path, { recursive: true });
      rmSync(target, { recursive: true, force: true });
      cpSync(src, target, { recursive: true });
      if (dest.host === 'codex' || dest.host === 'agents') {
        const yaml = join(target, 'agents', 'openai.yaml');
        if (!existsSync(yaml)) {
          mkdirSync(dirname(yaml), { recursive: true });
          writeFileSync(yaml, openaiYaml(skill));
        }
      }
    }
    written.push({ host: dest.host, dest: target, action: dry ? 'would-copy' : 'copied' });
    const depsSrc = join(root, '.cursor', 'skills', SKILL_DEPS);
    if (existsSync(join(depsSrc, 'SKILL.md'))) {
      const depsTarget = join(dest.path, SKILL_DEPS);
      if (!dry) {
        rmSync(depsTarget, { recursive: true, force: true });
        cpSync(depsSrc, depsTarget, { recursive: true });
      }
      written.push({ host: dest.host, dest: depsTarget, action: dry ? 'would-copy' : 'copied', skill: SKILL_DEPS });
    }
  }
  console.log(JSON.stringify({ ok: true, root, skill, written }, null, 2));
}

main();
