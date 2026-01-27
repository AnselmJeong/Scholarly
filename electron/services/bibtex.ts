// Generic BibTeX Generation Service
// Handles conversion of article metadata to BibTeX format

export interface BibtexMetadata {
  title?: string;
  authors?: string[];  // ["Family, Given", "Family, Given"]
  year?: number;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  publisher?: string;
  abstract?: string;
  type?: string;
}

/**
 * Generate a citation key for the article
 */
/**
 * Generate a citation key for the article
 * Format: AuthorYear (e.g., smith2024)
 * Handles duplicates if existingKeys set is provided
 */
export function generateCiteKey(data: BibtexMetadata, existingKeys?: Set<string>): string {
  let key = '';
  
  // First author's last name
  if (data.authors && data.authors.length > 0) {
    const firstAuthor = data.authors[0]; // Expecting "Family, Given" or just "Name"
    const familyName = firstAuthor.split(',')[0].trim();
    // Use only letters for the key
    key += familyName.toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
  } else {
    key += 'unknown';
  }
  
  // Year
  if (data.year) {
    key += data.year;
  }
  
  // Handle duplicates if set is provided
  let finalKey = key;
  if (existingKeys) {
    let suffixChar = 97; // 'a'
    while (existingKeys.has(finalKey) && suffixChar <= 122) { // up to 'z'
        finalKey = key + String.fromCharCode(suffixChar);
        suffixChar++;
    }
    // If we ran out of letters (rare), append numbers or just keep distinct
    if (existingKeys.has(finalKey)) {
        let counter = 1;
        while (existingKeys.has(finalKey)) {
            finalKey = key + counter;
            counter++;
        }
    }
    existingKeys.add(finalKey);
  }
  
  return finalKey;
}

function escapeLatex(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Convert a DB article object to BibTeX string
 */
export function articleToBibtex(article: any, existingKeys?: Set<string>): string {
  // Map DB article to GenericMetadata
  const metadata: BibtexMetadata = {
    title: article.title || article.filename.replace(/\.pdf$/i, ''),
    authors: article.authors ? article.authors.split(';').map((a: string) => a.trim()) : [],
    year: article.year,
    journal: article.journal,
    doi: article.doi,
    abstract: article.abstract,
    type: 'article'
  };

  const citeKey = generateCiteKey(metadata, existingKeys);
  const entryType = 'article';
  const fields: string[] = [];
  
  if (metadata.title) fields.push(`  title = {${escapeLatex(metadata.title)}}`);
  
  if (metadata.authors && metadata.authors.length > 0) {
    const bibAuthors = metadata.authors.join(' and ');
    fields.push(`  author = {${escapeLatex(bibAuthors)}}`);
  }
  
  if (metadata.year) fields.push(`  year = {${metadata.year}}`);
  if (metadata.journal) fields.push(`  journal = {${escapeLatex(metadata.journal)}}`);
  if (metadata.doi) fields.push(`  doi = {${metadata.doi}}`);
  if (metadata.abstract) {
    const abstract = metadata.abstract.length > 500 
      ? metadata.abstract.substring(0, 500) + '...' 
      : metadata.abstract;
    fields.push(`  abstract = {${escapeLatex(abstract)}}`);
  }
  
  return `@${entryType}{${citeKey},\n${fields.join(',\n')}\n}`;
}

/**
 * Generate BibTeX for a list of articles
 * Returns found entries, count, and list of items that couldn't be generated
 */
export function generateBibtexForArticles(
  articlesData: any[]
): { bibtex: string; found: number; notFound: string[] } {
  const bibtexEntries: string[] = [];
  const notFound: string[] = [];
  const usedKeys = new Set<string>();
  
  for (const article of articlesData) {
    // We consider it generatable if it has at least a title or filename
    const hasMinimalInfo = article.title || article.filename;
    
    if (hasMinimalInfo) {
      bibtexEntries.push(articleToBibtex(article, usedKeys));
    } else {
      notFound.push(article.filename || 'unknown');
    }
  }
  
  return {
    bibtex: bibtexEntries.join('\n\n'),
    found: bibtexEntries.length,
    notFound
  };
}
