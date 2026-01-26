// Keyword Deduplicator Service
// Reduces keyword count by removing the most similar pairs

import { cosineSimilarity } from './embedder';
import { getKeywordsByIds } from '../db/lancedb';

interface KeywordWithMeta {
    text: string;
    id: string;
    embedding: number[];
    usage_count?: number;
}

/**
 * Deduplicate keywords by removing most similar pairs
 * until target count is reached
 * 
 * Selection criteria when removing one from a pair:
 * 1. Lower usage_count is removed
 * 2. If tied, longer text is removed
 */
export async function deduplicateKeywords(
    keywords: { text: string; id: string; embedding: number[] }[],
    targetCount: number = 10
): Promise<{ text: string; id: string }[]> {
    if (keywords.length <= targetCount) {
        return keywords.map(k => ({ text: k.text, id: k.id }));
    }
    
    // Fetch usage counts from DB
    const ids = keywords.map(k => k.id);
    const dbRecords = await getKeywordsByIds(ids);
    const usageMap = new Map(dbRecords.map(r => [r.id, r.usage_count]));
    
    // Build working set with metadata
    let remaining: KeywordWithMeta[] = keywords.map(k => ({
        ...k,
        usage_count: usageMap.get(k.id) || 1
    }));
    
    while (remaining.length > targetCount) {
        let maxSim = -1;
        let pairIndices: [number, number] = [0, 1];
        
        // Find most similar pair
        for (let i = 0; i < remaining.length; i++) {
            for (let j = i + 1; j < remaining.length; j++) {
                const sim = cosineSimilarity(remaining[i].embedding, remaining[j].embedding);
                if (sim > maxSim) {
                    maxSim = sim;
                    pairIndices = [i, j];
                }
            }
        }
        
        // Decide which to remove
        const [i, j] = pairIndices;
        const a = remaining[i];
        const b = remaining[j];
        
        let removeIndex: number;
        if ((a.usage_count || 0) !== (b.usage_count || 0)) {
            // Remove the one with lower usage
            removeIndex = (a.usage_count || 0) < (b.usage_count || 0) ? i : j;
        } else {
            // Remove the longer text (more specific = less general)
            removeIndex = a.text.length > b.text.length ? i : j;
        }
        
        const removed = remaining[removeIndex];
        console.log(`  - Dedup: Removed "${removed.text}" (similar to "${remaining[removeIndex === i ? j : i].text}", sim: ${maxSim.toFixed(3)})`);
        
        remaining.splice(removeIndex, 1);
    }
    
    return remaining.map(k => ({ text: k.text, id: k.id }));
}
