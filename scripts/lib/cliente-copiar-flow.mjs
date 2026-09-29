import { basename, join } from 'node:path';

export function isFlowJson(file) {
  const base = basename(String(file ?? ''));
  return base === 'flow.json' || base.endsWith('.flow.json');
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
