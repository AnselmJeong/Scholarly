import fs from 'node:fs';
import path from 'node:path';

export function resolveRestorableRootPath(candidate: string | null | undefined): string | null {
  if (!candidate?.trim()) return null;
  const resolved = path.resolve(candidate);
  try {
    if (!fs.statSync(resolved).isDirectory()) return null;
    fs.accessSync(resolved, fs.constants.R_OK);
    return resolved;
  } catch {
    return null;
  }
}
