
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

/**
 * Extract text from a PDF file
 * Uses pdf-parse to extract raw text content
 */
export async function extractText(filePath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    // pdf-parse v1.1.1 exports a function directly that returns a promise
    const data = await pdf(dataBuffer);
    return trimReferences(data.text);
  } catch (error) {
    console.error(`Error extracting PDF text from ${filePath}:`, error);
    return '';
  }
}

function trimReferences(text: string): string {
  const lines = text.split('\n');
  // Regex matches:
  // ^\s*           : Start of line, optional whitespace
  // (?:[...])?     : Optional numbering (1., 12., VII., etc.)
  // (?:References|...): The keywords (case insensitive covers REFERENCES)
  // \s*$           : Optional whitespace, End of line
  const referencePattern = /^\s*(?:(?:[0-9]+|[IVX]+)\.?\s*)?(?:References|REFERENCES|Bibliography|BIBLIOGRAPHY|Literature Cited|LITERATURE CITED|References\s+and\s+Notes)\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (referencePattern.test(line)) {
      // Heuristic: If this occurs in the first 10% of lines, it might be TOC or Header.
      // But for now, we trust the strict pattern.
      // If found, return text up to this line.
      console.log(`[PDF] Trimming references at line ${i}/${lines.length}: "${line.trim()}"`);
      return lines.slice(0, i).join('\n');
    }
  }
  
  return text;
}
