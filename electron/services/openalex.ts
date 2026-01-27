// OpenAlex API Service
// Replaces CrossRef for metadata fetching and provides keywords from OpenAlex topics

const OPENALEX_BASE_URL = 'https://api.openalex.org';
const USER_AGENT = 'Scholarly/1.0 (mailto:anselmjeong@gmail.com)';

export interface OpenAlexAuthor {
  author: {
    id: string;
    display_name: string;
    orcid?: string;
  };
  institutions: { display_name: string }[];
}

export interface OpenAlexWork {
  id: string;
  title: string;
  doi?: string;
  publication_year?: number;
  authorships: OpenAlexAuthor[];
  primary_location?: {
    source?: {
      display_name: string;
      issn_l?: string;
      type?: string;
    };
  };
  abstract_inverted_index?: Record<string, number[]>;
  keywords?: { id: string; display_name: string; score: number }[];
  topics?: { id: string; display_name: string; score: number }[];
  type?: string;
}

interface OpenAlexResponse {
  meta: {
    count: number;
    db_response_time_ms: number;
    page: number;
    per_page: number;
  };
  results: OpenAlexWork[];
}

/**
 * Reconstruct abstract text from OpenAlex's inverted index format
 * 
 * The inverted index maps words to their positions:
 * { "Attractor": [0], "networks": [1, 14], "are": [2, 19, 75], ... }
 * 
 * We flatten this to an array sorted by position and join with spaces.
 */
export function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  if (!invertedIndex || Object.keys(invertedIndex).length === 0) {
    return '';
  }
  
  // Collect all (position, word) pairs
  const words: [number, string][] = [];
  
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  
  // Sort by position
  words.sort((a, b) => a[0] - b[0]);
  
  // Join words with spaces
  return words.map(([_, word]) => word).join(' ');
}

/**
 * Extract keywords from OpenAlex work
 * Combines keywords and topics, prioritizing by score
 */
export function extractKeywords(work: OpenAlexWork): string[] {
  const keywordSet = new Set<string>();
  
  // Add keywords (higher priority)
  if (work.keywords && work.keywords.length > 0) {
    for (const kw of work.keywords) {
      if (kw.display_name && kw.display_name.trim()) {
        keywordSet.add(kw.display_name.trim());
      }
    }
  }
  
  // Add topics as fallback/supplement
  if (work.topics && work.topics.length > 0) {
    // Sort by score descending
    const sortedTopics = [...work.topics].sort((a, b) => (b.score || 0) - (a.score || 0));
    
    for (const topic of sortedTopics.slice(0, 5)) { // Top 5 topics
      if (topic.display_name && topic.display_name.trim()) {
        keywordSet.add(topic.display_name.trim());
      }
    }
  }
  
  return Array.from(keywordSet).slice(0, 15); // Cap at 15 keywords
}

/**
 * Format authors from OpenAlex format to "Family, Given; ..." format
 */
export function formatAuthors(authorships: OpenAlexAuthor[]): string {
  if (!authorships || authorships.length === 0) return '';
  
  return authorships
    .map(a => {
      const name = a.author.display_name;
      // Try to parse "Given Family" into "Family, Given"
      const parts = name.split(' ');
      if (parts.length >= 2) {
        const family = parts[parts.length - 1];
        const given = parts.slice(0, -1).join(' ');
        return `${family}, ${given}`;
      }
      return name;
    })
    .join('; ');
}

/**
 * Fetch work from OpenAlex by DOI
 */
export async function fetchWorkByDOI(doi: string): Promise<OpenAlexWork | null> {
  try {
    // Normalize DOI - OpenAlex expects full DOI URL or just the DOI part
    const normalizedDOI = doi.startsWith('http') ? doi : `https://doi.org/${doi}`;
    const url = `${OPENALEX_BASE_URL}/works/${encodeURIComponent(normalizedDOI)}`;
    
    console.log(`[OpenAlex] Fetching by DOI: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[OpenAlex] DOI not found: ${doi}`);
        return null;
      }
      console.error(`[OpenAlex] API error: ${response.status}`);
      return null;
    }
    
    const work: OpenAlexWork = await response.json();
    console.log(`[OpenAlex] Found work: "${work.title}"`);
    return work;
    
  } catch (error) {
    console.error('[OpenAlex] Error fetching by DOI:', error);
    return null;
  }
}

/**
 * Search for work by title
 * Falls back when DOI is not available
 */
export async function searchWorkByTitle(title: string): Promise<OpenAlexWork | null> {
  try {
    // Sanitize title: remove ALL punctuation that might break the filter syntax (commas, semicolons, etc)
    // Keep alphanumeric, spaces, and hyphens only.
    const sanitizedTitle = title.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    const encodedTitle = encodeURIComponent(sanitizedTitle);
    
    // Check if title became empty
    if (!encodedTitle) return null;
    
    const url = `${OPENALEX_BASE_URL}/works?filter=title.search:${encodedTitle}&per-page=1`;
    
    console.log(`[OpenAlex] Searching by title: ${title}`);
    console.log(`[OpenAlex] Sanitized: ${sanitizedTitle}`);
    console.log(`[OpenAlex] URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    
    if (!response.ok) {
      console.error(`[OpenAlex] Search error: ${response.status} for title: "${title}"`);
      return null;
    }
    
    const data: OpenAlexResponse = await response.json();
    
    if (data.results && data.results.length > 0) {
      const work = data.results[0];
      console.log(`[OpenAlex] Found: "${work.title}" (${data.meta.count} total results)`);
      return work;
    }
    
    console.log(`[OpenAlex] No results for title: ${title}`);
    return null;
    
  } catch (error) {
    console.error('[OpenAlex] Error searching by title:', error);
    return null;
  }
}

/**
 * Main function: Fetch metadata and keywords for a paper
 * Tries DOI first, then falls back to title search
 */
export async function fetchPaperMetadata(
  titleOrDOI: string,
  existingDOI?: string
): Promise<{
  title?: string;
  authors?: string;
  year?: number;
  journal?: string;
  doi?: string;
  abstract?: string;
  keywords: string[];
} | null> {
  let work: OpenAlexWork | null = null;
  
  // Try DOI first if provided
  if (existingDOI) {
    work = await fetchWorkByDOI(existingDOI);
  }
  
  // Fall back to title search
  if (!work) {
    work = await searchWorkByTitle(titleOrDOI);
  }
  
  if (!work) {
    return null;
  }
  
  // Extract all metadata
  const result = {
    title: work.title,
    authors: formatAuthors(work.authorships),
    year: work.publication_year,
    journal: work.primary_location?.source?.display_name,
    doi: work.doi?.replace('https://doi.org/', ''),
    abstract: work.abstract_inverted_index 
      ? reconstructAbstract(work.abstract_inverted_index)
      : undefined,
    keywords: extractKeywords(work)
  };
  
  console.log(`[OpenAlex] Extracted ${result.keywords.length} keywords:`, result.keywords);
  
  return result;
}
