// LanceDB Vector Database for Keyword Storage
// Stores keyword embeddings for similarity search

import * as lancedb from '@lancedb/lancedb';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { app } from 'electron';

let db: lancedb.Connection | null = null;
let keywordsTable: lancedb.Table | null = null;

const EMBEDDING_DIM = 4096;  // qwen3-embedding actual dimensions

export interface KeywordRecord {
    id: string;
    text: string;
    embedding: number[];
    usage_count: number;
    created_at: string;
    last_used_at: string;
}

export interface SearchResult extends KeywordRecord {
    _distance: number;  // LanceDB returns distance (1 - similarity for normalized vectors)
}

export async function initLanceDB(): Promise<void> {
    if (db) return;
    
    const dbPath = path.join(app.getPath('userData'), 'keywords.lance');
    console.log(`Initializing LanceDB at: ${dbPath}`);
    
    db = await lancedb.connect(dbPath);
    
    try {
        keywordsTable = await db.openTable('keywords');
        console.log('Opened existing keywords table.');
        
        // Validate schema - check if vector column exists and has correct dimension
        try {
            // Perform a dummy search to check if vector search works
            await keywordsTable.search(new Array(EMBEDDING_DIM).fill(0)).limit(1).toArray();
        } catch (e) {
            console.warn('Vector dimension mismatch or invalid schema, recreating table...', e);
            await db.dropTable('keywords');
            throw new Error('Schema mismatch'); // Force recreation in catch block
        }
        
    } catch {
        // Table doesn't exist or was dropped, create it
        console.log('Creating new keywords table...');
        
        // LanceDB requires initial data to infer schema correctly including vector dimension
        // We add a dummy row and properly clean it up
        await db.createTable('keywords', [
            {
                id: '__init__',
                text: '__initialization__',
                embedding: new Array(EMBEDDING_DIM).fill(0.0), // Ensure float
                usage_count: 0,
                created_at: new Date().toISOString(),
                last_used_at: new Date().toISOString()
            }
        ]);
        
        keywordsTable = await db.openTable('keywords');
        await keywordsTable.delete('id = "__init__"');
        console.log('Keywords table created with correct vector dimension.');
    }
}

export async function searchSimilar(embedding: number[], limit: number = 1): Promise<SearchResult[]> {
    if (!keywordsTable) {
        throw new Error('LanceDB not initialized. Call initLanceDB() first.');
    }
    
    if (embedding.length === 0) {
        console.error('searchSimilar called with empty embedding!');
        throw new Error('Cannot search with empty embedding');
    }
    // console.log(`Searching with embedding of length: ${embedding.length}`);
    
    const results = await keywordsTable.search(embedding)
        .limit(limit)
        .toArray();
    
    return results as SearchResult[];
}

export async function addKeyword(text: string, embedding: number[]): Promise<string> {
    if (!keywordsTable) {
        throw new Error('LanceDB not initialized. Call initLanceDB() first.');
    }
    
    const id = uuidv4();
    const now = new Date().toISOString();
    
    await keywordsTable.add([{
        id,
        text,
        embedding,
        usage_count: 1,
        created_at: now,
        last_used_at: now
    }]);
    
    console.log(`Added new keyword to LanceDB: "${text}" (id: ${id})`);
    return id;
}

export async function incrementUsage(id: string): Promise<void> {
    if (!keywordsTable) {
        throw new Error('LanceDB not initialized. Call initLanceDB() first.');
    }
    
    // LanceDB update - fetch, modify, and update
    const existing = await keywordsTable.query()
        .filter(`id = "${id}"`)
        .limit(1)
        .toArray();
    
    if (existing.length > 0) {
        const record = existing[0] as KeywordRecord;
        await keywordsTable.update({
            where: `id = "${id}"`,
            values: {
                usage_count: record.usage_count + 1,
                last_used_at: new Date().toISOString()
            }
        });
    }
}

export async function getKeywordById(id: string): Promise<KeywordRecord | null> {
    if (!keywordsTable) {
        throw new Error('LanceDB not initialized. Call initLanceDB() first.');
    }
    
    const results = await keywordsTable.query()
        .filter(`id = "${id}"`)
        .limit(1)
        .toArray();
    
    return results.length > 0 ? (results[0] as KeywordRecord) : null;
}

export async function getKeywordsByIds(ids: string[]): Promise<KeywordRecord[]> {
    if (!keywordsTable) {
        throw new Error('LanceDB not initialized. Call initLanceDB() first.');
    }
    
    const filterExpr = ids.map(id => `id = "${id}"`).join(' OR ');
    const results = await keywordsTable.query()
        .filter(filterExpr)
        .limit(ids.length)
        .toArray();
    
    return results as KeywordRecord[];
}

export async function getPoolStats(): Promise<{
    totalKeywords: number;
    avgUsageCount: number;
    singleUseKeywords: number;
}> {
    if (!keywordsTable) {
        return { totalKeywords: 0, avgUsageCount: 0, singleUseKeywords: 0 };
    }
    
    const all = await keywordsTable.query().limit(10000).toArray() as KeywordRecord[];
    
    if (all.length === 0) {
        return { totalKeywords: 0, avgUsageCount: 0, singleUseKeywords: 0 };
    }
    
    return {
        totalKeywords: all.length,
        avgUsageCount: all.reduce((sum, k) => sum + k.usage_count, 0) / all.length,
        singleUseKeywords: all.filter(k => k.usage_count === 1).length
    };
}
