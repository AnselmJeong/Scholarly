import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractDocument } from './pdf';
import { PDF_EXTRACTION_VERSION, sha256 } from './digest';
import type { ExtractedDocument } from './digest';

export async function extractDocumentCached(pdf: string, sourceHash: string, directory: string): Promise<ExtractedDocument> {
  const key = sha256(`${sourceHash}:${PDF_EXTRACTION_VERSION}`);
  const file = path.join(directory, `${key}.pages.json`);
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.key === key && value.hash === sha256(JSON.stringify(value.document)) &&
        Array.isArray(value.document?.pages) && Number.isInteger(value.document?.pageCount) &&
        value.document.pages.every((page: { pageNumber: number; text: string }) => Number.isInteger(page.pageNumber) && page.pageNumber > 0 && typeof page.text === 'string')) return value.document;
  } catch { /* Re-extract missing or invalid caches. */ }
  const document = await extractDocument(pdf, { omitReferences: true });
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ key, document, hash: sha256(JSON.stringify(document)) }), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
  return document;
}
