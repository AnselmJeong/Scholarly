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

export interface PdfExtractionOptions {
  omitReferences?: boolean;
}

interface ReferenceSectionBoundary {
  startPageIndex: number;
  startOffset: number;
  endPageIndex: number;
  endOffset: number;
  heading: string;
}

const REFERENCE_HEADING_PATTERN = /^(?:references|bibliography|works cited|literature cited|reference list)\s*:?\s*$/gim;
const POST_REFERENCE_HEADING_PATTERN = /^(?:appendix|appendices|supplementary (?:material|materials|information)|supplemental (?:material|materials|information))\s*:?\s*$/gim;

function headingMatches(text: string, pattern: RegExp): Array<{ start: number; end: number; heading: string }> {
  const matches: Array<{ start: number; end: number; heading: string }> = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    matches.push({ start, end: start + match[0].length, heading: match[0].trim().replace(/:$/, '') });
  }
  return matches;
}

function referenceSectionLooksGenuine(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 400) return false;
  const sample = normalized.slice(0, 6_000);
  const yearCount = sample.match(/\b(?:18|19|20)\d{2}[a-z]?\b/gi)?.length ?? 0;
  const doiOrUrlCount = sample.match(/(?:\bdoi\b|https?:\/\/|www\.)/gi)?.length ?? 0;
  const numberedEntryCount = sample.match(/^\s*(?:\[\d+\]|\d+[.)])\s+/gm)?.length ?? 0;
  const authorYearLineCount = sample
    .split('\n')
    .filter(line => /\b(?:18|19|20)\d{2}[a-z]?\b/i.test(line) && /[A-Za-zÀ-ÖØ-öø-ÿ]{2,}/.test(line))
    .length;
  return yearCount >= 3 && (doiOrUrlCount >= 1 || numberedEntryCount >= 3 || authorYearLineCount >= 3);
}

function findReferenceSection(pages: ExtractedPage[]): ReferenceSectionBoundary | null {
  const totalCharacters = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (totalCharacters === 0) return null;

  let charactersBeforePage = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const candidates = headingMatches(page.text, REFERENCE_HEADING_PATTERN);
    for (const candidate of candidates) {
      const globalStart = charactersBeforePage + candidate.start;
      const positionRatio = globalStart / totalCharacters;
      if (globalStart < 500 || positionRatio < 0.35) continue;

      let endPageIndex = pages.length - 1;
      let endOffset = pages[endPageIndex]?.text.length ?? 0;
      let sectionText = page.text.slice(candidate.end);

      for (let laterPageIndex = pageIndex + 1; laterPageIndex < pages.length; laterPageIndex += 1) {
        const laterPage = pages[laterPageIndex];
        const nextSection = headingMatches(laterPage.text, POST_REFERENCE_HEADING_PATTERN)[0];
        if (nextSection) {
          endPageIndex = laterPageIndex;
          endOffset = nextSection.start;
          sectionText += `\n${laterPage.text.slice(0, nextSection.start)}`;
          break;
        }
        sectionText += `\n${laterPage.text}`;
      }

      if (referenceSectionLooksGenuine(sectionText)) {
        return {
          startPageIndex: pageIndex,
          startOffset: candidate.start,
          endPageIndex,
          endOffset,
          heading: candidate.heading
        };
      }
    }
    charactersBeforePage += page.text.length;
  }

  charactersBeforePage = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const candidates = Array.from(page.text.matchAll(/^\s*1\.\s+\S/gm));
    for (const candidate of candidates) {
      const startOffset = candidate.index;
      const globalStart = charactersBeforePage + startOffset;
      if (globalStart < 500 || globalStart / totalCharacters < 0.35) continue;

      let endPageIndex = pages.length - 1;
      let endOffset = pages[endPageIndex]?.text.length ?? 0;
      let sectionText = page.text.slice(startOffset);
      for (let laterPageIndex = pageIndex + 1; laterPageIndex < pages.length; laterPageIndex += 1) {
        const laterPage = pages[laterPageIndex];
        const nextSection = headingMatches(laterPage.text, POST_REFERENCE_HEADING_PATTERN)[0];
        if (nextSection) {
          endPageIndex = laterPageIndex;
          endOffset = nextSection.start;
          sectionText += `\n${laterPage.text.slice(0, nextSection.start)}`;
          break;
        }
        sectionText += `\n${laterPage.text}`;
      }

      const entryNumbers = Array.from(sectionText.matchAll(/^\s*(\d{1,4})\.\s+\S/gm), match => Number(match[1]));
      const firstEntriesAreSequential = entryNumbers.slice(0, 5).every((number, index) => number === index + 1);
      if (
        entryNumbers.length >= 10 &&
        firstEntriesAreSequential &&
        referenceSectionLooksGenuine(sectionText)
      ) {
        return {
          startPageIndex: pageIndex,
          startOffset,
          endPageIndex,
          endOffset,
          heading: 'Numbered references'
        };
      }
    }
    charactersBeforePage += page.text.length;
  }
  return null;
}

export function omitReferenceSection(pages: ExtractedPage[]): {
  pages: ExtractedPage[];
  referencesOmitted: boolean;
  diagnostic: string | null;
} {
  const boundary = findReferenceSection(pages);
  if (!boundary) return { pages, referencesOmitted: false, diagnostic: null };

  const filteredPages: ExtractedPage[] = [];
  let removedCharacters = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    if (pageIndex < boundary.startPageIndex || pageIndex > boundary.endPageIndex) {
      filteredPages.push(page);
      continue;
    }

    const keptPrefix = pageIndex === boundary.startPageIndex
      ? page.text.slice(0, boundary.startOffset).trimEnd()
      : '';
    const keptSuffix = pageIndex === boundary.endPageIndex
      ? page.text.slice(boundary.endOffset).trimStart()
      : '';
    removedCharacters += page.text.length - keptPrefix.length - keptSuffix.length;
    const retainedText = [keptPrefix, keptSuffix].filter(Boolean).join('\n').trim();
    if (retainedText) filteredPages.push({ ...page, text: retainedText });
  }

  const startPage = pages[boundary.startPageIndex].pageNumber;
  const endPage = pages[boundary.endPageIndex].pageNumber;
  return {
    pages: filteredPages,
    referencesOmitted: true,
    diagnostic: `${boundary.heading} section omitted from physical PDF pages ${startPage}-${endPage}; ${removedCharacters} extracted characters removed.`
  };
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
export async function extractDocument(
  filePath: string,
  options: PdfExtractionOptions = {}
): Promise<ExtractedDocument> {
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

  const referenceFiltering = options.omitReferences
    ? omitReferenceSection(pages)
    : { pages, referencesOmitted: false, diagnostic: null };
  if (referenceFiltering.diagnostic) diagnostics.push(referenceFiltering.diagnostic);

  return {
    pageCount: data.numpages,
    pages: referenceFiltering.pages,
    referencesOmitted: referenceFiltering.referencesOmitted,
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
