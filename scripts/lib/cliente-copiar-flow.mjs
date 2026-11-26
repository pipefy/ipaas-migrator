import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { inspectFlowGraph } from './flow-graph-guard.mjs';

export function isFlowJson(file) {
  const base = basename(String(file ?? ''));
  return base === 'flow.json' || base.endsWith('.flow.json');
}

export function flowFileIssue(file) {
  let json;
  let text;
  try {
    text = readFileSync(file, 'utf8');
    json = JSON.parse(text);
  } catch {
    return 'invalid_json';
  }
  if (!inspectFlowGraph(json).ok) return 'invalid_flow_graph';
  const base = basename(file);
  if (base.endsWith('.flow.json') && base !== 'flow.json') {
    const sibling = join(dirname(file), 'flow.json');
    if (existsSync(sibling) && readFileSync(sibling, 'utf8') !== text) return 'flow_desatualizado';
  }
  return null;
}

export function downloadsDir({ home, platform = 'linux', userDirsText = '', env = {} }) {
  if (platform === 'win32') return join(env.USERPROFILE || home, 'Downloads');
  if (userDirsText) {
    const match = userDirsText.match(/^XDG_DOWNLOAD_DIR="([^"]+)"/m);
    if (match) {
      return match[1].replace(/\$HOME\b/g, home).replace(/^~(?=\/)/, home);
    }
  }
  return join(home, 'Downloads');
}
