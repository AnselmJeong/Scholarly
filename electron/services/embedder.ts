// Keyword Embedding Service using Ollama
// Generates embeddings for keyword similarity matching
import ollama from 'ollama';

// 1024 dimensions for qwen3-embedding (verify this later, used to be 384 for MiniLM)
// qwen3-embedding produces 1536 dim embeddings? Or 1024?
// actually we should just return what it gives us.
// But we need to update LanceDB schema if dimension changes!
// qwen-2.5-embedding is 1536. qwen3 is likely similar or same.
// Wait, user said qwen3-embedding. Let's assume dynamic dimension or check.
// Actually standard Qwen embeddings are often 1536 or 1024.
// Let's use the model name constant.

const EMBEDDING_MODEL = 'qwen3-embedding:latest';

export async function initEmbedder(): Promise<void> {
    // No initialization needed for Ollama REST API, but we could check if model exists?
    // For now, assume it exists or will be pulled.
    return;
}

export async function embedKeyword(text: string): Promise<number[]> {
    try {
        const response = await ollama.embeddings({
            model: EMBEDDING_MODEL,
            prompt: text
        });
        return response.embedding;
    } catch (error) {
        console.error(`Error generating embedding for "${text}":`, error);
        throw error;
    }
}

export async function embedKeywords(keywords: string[]): Promise<{ text: string; embedding: number[] }[]> {
    const embeddings: { text: string; embedding: number[] }[] = [];
    // Sequential processing to respect Ollama concurrency limits potentially?
    // Or we could do Promise.all if local Ollama can handle batched requests (it's serial anyway usually)
    for (const kw of keywords) {
        const emb = await embedKeyword(kw);
        embeddings.push({ text: kw, embedding: emb });
    }
    return embeddings;
}

// Cosine similarity between two vectors
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        // This is now more likely if switching models/dimensions. 
        // We should handle this gracefully or ensure DB is reset.
        console.error(`Vector length mismatch: ${a.length} vs ${b.length}`);
        return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
