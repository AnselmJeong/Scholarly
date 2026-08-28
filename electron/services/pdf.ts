import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { ExtractedDocument, ExtractedPage } from './digest';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse') as (
  buffer: Buffer,
  options?: { pagerender?: (pageData: PdfPageData) => Promise<string>; max?: number }
) => Promise<{ numpages: number; numrender: number; text: string }>;

interface PdfTextItem {
  str: string;
  transform: number[];
}

interface PdfPageData {
  getTextContent(options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }): Promise<{ items: PdfTextItem[] }>;
}

async function renderPage(pageData: PdfPageData): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  });

  let lastY: number | undefined;
  let text = '';
  for (const item of textContent.items) {
    const y = item.transform[5];
    text += lastY === undefined || lastY === y ? item.str : `\n${item.str}`;
    lastY = y;
  }
  return text.trim();
}

/**
 * Extract a PDF without flattening page boundaries. Physical PDF page indices
 * are exposed as 1-based page numbers; printed page-label offsets are not
 * currently inferred.
 */
export async function extractDocument(filePath: string): Promise<ExtractedDocument> {
  const dataBuffer = await fs.promises.readFile(filePath);
  const renderedPages: string[] = [];

  const data = await pdf(dataBuffer, {
    max: 0,
    pagerender: async pageData => {
      const text = await renderPage(pageData);
      renderedPages.push(text);
      return text;
    }
  });

  // pdf-parse 1.x invokes pagerender sequentially but does not return a public
  // pageData array, so callback order is the physical page order.
  const pages: ExtractedPage[] = Array.from({ length: data.numpages }, (_, index) => ({
    pageNumber: index + 1,
    text: renderedPages[index] ?? ''
  }));
  const diagnostics = pages
    .filter(page => !page.text.trim())
    .map(page => `Physical page ${page.pageNumber} yielded no extractable text.`);

  if (pages.length === 0 || pages.every(page => !page.text.trim())) {
    throw new Error('The PDF is empty, scanned without a text layer, or unreadable. No extractable page text was found.');
  }

  return {
    pageCount: data.numpages,
    pages,
    referencesOmitted: false,
    diagnostics
  };
}

/** Compatibility helper for paper chat. Digest generation uses the
 * page-preserving extractDocument() API directly. */
export async function extractText(filePath: string): Promise<string> {
  const document = await extractDocument(filePath);
  return document.pages
    .map(page => `[PDF page ${page.pageNumber}]\n${page.text}`)
    .join('\n\n');
}
