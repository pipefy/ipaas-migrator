// Le entradas: arquivo .json, .zip (varios recipes) ou pasta.
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import AdmZip from 'adm-zip';

export interface Ingested { file: string; json: any; path?: string }

async function readDirRecursive(dir: string, out: Ingested[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await readDirRecursive(full, out);
    } else if (entry.name.endsWith('.json') && !/connection\.json$/i.test(entry.name)) {
      const json = JSON.parse(await readFile(full, 'utf8'));
      // Directories downloaded through Workato's Developer API also contain
      // manifest/progress JSON files. Only ingest actual recipes.
      if (json && typeof json === 'object' && 'code' in json) {
        out.push({ file: entry.name, json, path: full });
      }
    }
  }
}

export async function ingest(inputPath: string): Promise<Ingested[]> {
  const st = await stat(inputPath);
  if (st.isDirectory()) {
    const out: Ingested[] = [];
    await readDirRecursive(inputPath, out);
    return out;
  }
  const ext = extname(inputPath).toLowerCase();
  if (ext === '.zip') {
    const zip = new AdmZip(inputPath);
    const out: Ingested[] = [];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (!entry.entryName.endsWith('.json')) continue;
      if (/connection\.json$/i.test(entry.entryName)) continue; // ignora conexoes
      try {
        const json = JSON.parse(entry.getData().toString('utf8'));
        if (json && typeof json === 'object' && 'code' in json) {
          out.push({ file: basename(entry.entryName), json }); // zip: json em memoria, sem path
        }
      } catch {
        // ignora entradas nao-JSON
      }
    }
    return out;
  }
  // arquivo json unico
  return [{ file: basename(inputPath), json: JSON.parse(await readFile(inputPath, 'utf8')), path: inputPath }];
}
