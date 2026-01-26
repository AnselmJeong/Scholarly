// Keyword Matcher Service
// Matches extracted keywords against existing pool using embedding similarity

import { searchSimilar, addKeyword, incrementUsage } from '../db/lancedb';

// Threshold for considering two keywords as the same
// 0.88 means keywords with 88%+ similarity are considered identical
const SIMILARITY_THRESHOLD = 0.88;

export interface MatchedKeyword {
    text: string;
    id: string;
    embedding: number[];
    isExisting: boolean;
}

/**
 * Match extracted keywords against existing pool
 * - If similarity > threshold: reuse existing keyword
 * - Otherwise: add as new keyword to pool
 */
export async function matchKeywords(
    keywordsWithEmbeddings: { text: string; embedding: number[] }[]
): Promise<MatchedKeyword[]> {
    const matched: MatchedKeyword[] = [];
    
    for (const { text, embedding } of keywordsWithEmbeddings) {
        const [topMatch] = await searchSimilar(embedding, 1);
        
        if (topMatch) {
            // LanceDB returns distance, not similarity
            // For normalized vectors: distance = 1 - cosine_similarity
            const similarity = 1 - topMatch._distance;
            
            if (similarity >= SIMILARITY_THRESHOLD) {
                console.log(`  ✓ Matched: "${text}" → "${topMatch.text}" (similarity: ${similarity.toFixed(3)})`);
                matched.push({
                    text: topMatch.text,
                    id: topMatch.id,
                    embedding: topMatch.embedding,
                    isExisting: true
                });
                await incrementUsage(topMatch.id);
            } else {
                console.log(`  + New: "${text}" (best match: "${topMatch.text}" at ${similarity.toFixed(3)})`);
                const newId = await addKeyword(text, embedding);
                matched.push({
                    text,
                    id: newId,
                    embedding,
                    isExisting: false
                });
            }
        } else {
            // No matches in pool (likely first keyword)
            console.log(`  + New: "${text}" (empty pool)`);
            const newId = await addKeyword(text, embedding);
            matched.push({
                text,
                id: newId,
                embedding,
                isExisting: false
            });
        }
    }
    
    return matched;
}
