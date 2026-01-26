// Keyword Processing Pipeline
// Orchestrates the 3-phase keyword extraction process

import { extractKeywordsRaw } from './ai';
import { embedKeywords } from './embedder';
import { matchKeywords } from './keywordMatcher';
import { deduplicateKeywords } from './keywordDeduplicator';
import { initLanceDB } from '../db/lancedb';

const KEYWORDS_TO_KEEP = 10;

export interface ProcessedKeyword {
    text: string;
    id: string;
}

/**
 * Main keyword processing pipeline
 * 
 * Phase 1: Free extraction (LLM extracts 15 keywords without pool reference)
 * Phase 2: Embedding & Matching (vector similarity against existing pool)
 * Phase 3: Deduplication (reduce 15 → 10 by removing similar pairs)
 */
export async function processKeywords(paperText: string): Promise<ProcessedKeyword[]> {
    // Ensure LanceDB is initialized
    await initLanceDB();
    
    console.log('\n🔑 Starting keyword extraction pipeline...');
    
    // Phase 1: Free extraction
    console.log('\n📝 Phase 1: Free extraction...');
    const rawKeywords = await extractKeywordsRaw(paperText);
    console.log(`   Extracted ${rawKeywords.length} raw keywords:`, rawKeywords);
    
    if (rawKeywords.length === 0) {
        console.warn('   ⚠️ No keywords extracted from paper');
        return [];
    }
    
    // Phase 2: Embedding & Matching
    console.log('\n🔗 Phase 2: Embedding & Matching...');
    const withEmbeddings = await embedKeywords(rawKeywords);
    const matched = await matchKeywords(withEmbeddings);
    
    const existingCount = matched.filter(k => k.isExisting).length;
    const newCount = matched.filter(k => !k.isExisting).length;
    console.log(`   Matched: ${existingCount} existing, ${newCount} new`);
    
    // Phase 3: Deduplication
    console.log('\n✂️ Phase 3: Deduplication...');
    const final = await deduplicateKeywords(matched, KEYWORDS_TO_KEEP);
    console.log(`   Final: ${final.length} keywords`);
    
    console.log('\n✅ Keyword pipeline complete:', final.map(k => k.text));
    
    return final;
}
