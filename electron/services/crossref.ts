// Crossref API service for fetching article metadata and generating BibTeX

export interface CrossrefWork {
  DOI: string;
  title: string[];
  author?: { given: string; family: string }[];
  'container-title'?: string[];
  issued?: { 'date-parts': number[][] };
  volume?: string;
  issue?: string;
  page?: string;
  abstract?: string;
  publisher?: string;
  type?: string;
}

export interface CrossrefResponse {
  message: {
    items: CrossrefWork[];
  };
}

// Search Crossref by title
export async function searchCrossref(title: string): Promise<CrossrefWork | null> {
  try {
    const encodedTitle = encodeURIComponent(title);
    const url = `https://api.crossref.org/works?query.title=${encodedTitle}&rows=1`;
    console.log(`[Crossref] Fetching: ${url}`);
    
    const response = await fetch(
      url,
      {
        headers: {
          'User-Agent': 'AcademicKeywordManager/1.0 (mailto:anselmjeong@gmail.com)'
        }
      }
    );

    console.log(`[Crossref] Response status: ${response.status}`);

    if (!response.ok) {
      console.error('Crossref API error:', response.status);
      return null;
    }

    const data: CrossrefResponse = await response.json();
    console.log(`[Crossref] Items found: ${data.message.items?.length || 0}`);
    
    if (data.message.items && data.message.items.length > 0) {
      const item = data.message.items[0];
      console.log(`[Crossref] Top result: "${item.title?.[0]}" by ${item.author?.[0]?.family}`);
      return item;
    }
    return null;
  } catch (error) {
    console.error('Error searching Crossref:', error);
    return null;
  }
}

// Convert Crossref work to BibTeX format
export function workToBibtex(work: CrossrefWork, citeKey?: string): string {
  const key = citeKey || generateCiteKey(work);
  const entryType = mapCrossrefType(work.type || 'article');
  
  const fields: string[] = [];
  
  // Title
  if (work.title && work.title.length > 0) {
    fields.push(`  title = {${escapeLatex(work.title[0])}}`);
  }
  
  // Authors
  if (work.author && work.author.length > 0) {
    const authors = work.author
      .map(a => `${a.family}, ${a.given}`)
      .join(' and ');
    fields.push(`  author = {${authors}}`);
  }
  
  // Year
  if (work.issued && work.issued['date-parts'] && work.issued['date-parts'][0]) {
    const year = work.issued['date-parts'][0][0];
    if (year) fields.push(`  year = {${year}}`);
  }
  
  // Journal
  if (work['container-title'] && work['container-title'].length > 0) {
    fields.push(`  journal = {${escapeLatex(work['container-title'][0])}}`);
  }
  
  // Volume
  if (work.volume) {
    fields.push(`  volume = {${work.volume}}`);
  }
  
  // Issue/Number
  if (work.issue) {
    fields.push(`  number = {${work.issue}}`);
  }
  
  // Pages
  if (work.page) {
    fields.push(`  pages = {${work.page.replace('-', '--')}}`);
  }
  
  // DOI
  if (work.DOI) {
    fields.push(`  doi = {${work.DOI}}`);
  }
  
  // Publisher
  if (work.publisher) {
    fields.push(`  publisher = {${escapeLatex(work.publisher)}}`);
  }
  
  // Abstract
  if (work.abstract) {
    const cleanAbstract = work.abstract
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\n/g, ' ')
      .trim();
    fields.push(`  abstract = {${escapeLatex(cleanAbstract)}}`);
  }
  
  return `@${entryType}{${key},\n${fields.join(',\n')}\n}`;
}

function generateCiteKey(work: CrossrefWork): string {
  let key = '';
  
  // First author's last name
  if (work.author && work.author.length > 0) {
    key += work.author[0].family?.toLowerCase().replace(/\s+/g, '') || 'unknown';
  } else {
    key += 'unknown';
  }
  
  // Year
  if (work.issued && work.issued['date-parts'] && work.issued['date-parts'][0]) {
    key += work.issued['date-parts'][0][0] || '';
  }
  
  // First significant word from title
  if (work.title && work.title.length > 0) {
    const words = work.title[0].split(/\s+/);
    const significantWord = words.find(w => w.length > 3 && !/^(the|and|for|with|from)$/i.test(w));
    if (significantWord) {
      key += significantWord.toLowerCase().replace(/[^a-z]/g, '');
    }
  }
  
  return key || 'ref';
}

function mapCrossrefType(type: string): string {
  const typeMap: Record<string, string> = {
    'journal-article': 'article',
    'book': 'book',
    'book-chapter': 'incollection',
    'proceedings-article': 'inproceedings',
    'dissertation': 'phdthesis',
    'report': 'techreport',
  };
  return typeMap[type] || 'article';
}

function escapeLatex(text: string): string {
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

// Convert DB article to BibTeX format
export function dbArticleToBibtex(article: any): string {
  const citeKey = generateCiteKey({
    author: article.authors ? article.authors.split(';').map((a: string) => {
      const parts = a.trim().split(',');
      return { family: parts[0] ? parts[0].trim() : '', given: parts[1] ? parts[1].trim() : '' };
    }) : [],
    title: article.title ? [article.title] : [article.filename],
    issued: { 'date-parts': [[article.year || 0]] }
  } as any);

  const entryType = 'article';
  const fields: string[] = [];
  
  if (article.title) fields.push(`  title = {${escapeLatex(article.title)}}`);
  else if (article.filename) fields.push(`  title = {${escapeLatex(article.filename)}}`);
  
  if (article.authors) {
    const bibAuthors = article.authors.split(';').map((a: string) => a.trim()).join(' and ');
    fields.push(`  author = {${escapeLatex(bibAuthors)}}`);
  }
  
  if (article.year) fields.push(`  year = {${article.year}}`);
  if (article.journal) fields.push(`  journal = {${escapeLatex(article.journal)}}`);
  if (article.doi) fields.push(`  doi = {${article.doi}}`);
  if (article.abstract) {
    fields.push(`  abstract = {${escapeLatex(article.abstract.substring(0, 500) + (article.abstract.length > 500 ? '...' : ''))}}`);
  }
  
  return `@${entryType}{${citeKey},\n${fields.join(',\n')}\n}`;
}

// Generate BibTeX for multiple articles
export async function generateBibtexForArticles(
  articlesData: any[]
): Promise<{ bibtex: string; found: number; notFound: string[] }> {
  const bibtexEntries: string[] = [];
  const notFound: string[] = [];
  
  for (const article of articlesData) {
    // Check if we already have sufficient metadata in DB
    const hasMetadata = article.doi || (article.title && article.authors && article.year);
    
    if (hasMetadata) {
      console.log(`Using DB metadata for: ${article.title || article.filename}`);
      bibtexEntries.push(dbArticleToBibtex(article));
    } else {
      const searchTitle = article.title || article.filename.replace(/\.pdf$/i, '');
      console.log(`Searching Crossref for: ${searchTitle}`);
      
      const work = await searchCrossref(searchTitle);
      if (work) {
        bibtexEntries.push(workToBibtex(work));
      } else {
        // Even if not found in Crossref, we can generate a basic entry from whatever we have
        bibtexEntries.push(dbArticleToBibtex(article));
      }
      
      // Rate limiting for API calls
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return {
    bibtex: bibtexEntries.join('\n\n'),
    found: bibtexEntries.length,
    notFound
  };
}
