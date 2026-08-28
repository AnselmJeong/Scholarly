import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';
import { app } from 'electron';

let sqlite: Database.Database | null = null;
let db: BetterSQLite3Database<typeof schema> | null = null;

export function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDB first.');
    }
    return db;
}

export function initDB() {
    const dbPath = path.join(app.getPath('userData'), 'database.sqlite');
    console.log('Database path:', dbPath);

    sqlite = new Database(dbPath);
    db = drizzle(sqlite, { schema });

    const run = (query: string) => sqlite!.exec(query);

    run(`
    CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        file_path TEXT UNIQUE NOT NULL,
        title TEXT,
        authors TEXT,
        year INTEGER,
        journal TEXT,
        doi TEXT,
        metadata_source TEXT,
        abstract TEXT,
        added_date INTEGER,
        last_modified INTEGER,
        file_hash TEXT,
        file_size INTEGER,
        is_key INTEGER DEFAULT 0
    );
    `);

    // Migration: Add is_key column if it doesn't exist
    try {
        const tableInfo = sqlite!.prepare("PRAGMA table_info(articles)").all() as any[];
        const hasIsKey = tableInfo.some(col => col.name === 'is_key');
        if (!hasIsKey) {
            console.log('Migrating: Adding is_key column to articles table');
            run(`ALTER TABLE articles ADD COLUMN is_key INTEGER DEFAULT 0;`);
        }
    } catch (e) {
        console.error('Migration failed:', e);
    }

    // Migration: record whether portable digest metadata came from a verified
    // service or the filename fallback.
    try {
        const tableInfo = sqlite!.prepare("PRAGMA table_info(articles)").all() as Array<{ name: string }>;
        const hasMetadataSource = tableInfo.some(col => col.name === 'metadata_source');
        if (!hasMetadataSource) {
            console.log('Migrating: Adding metadata_source column to articles table');
            run(`ALTER TABLE articles ADD COLUMN metadata_source TEXT;`);
        }
    } catch (e) {
        console.error('Migration for metadata_source failed:', e);
    }

    // Migration: Add is_read column if it doesn't exist
    try {
        const tableInfo = sqlite!.prepare("PRAGMA table_info(articles)").all() as any[];
        const hasIsRead = tableInfo.some(col => col.name === 'is_read');
        if (!hasIsRead) {
            console.log('Migrating: Adding is_read column to articles table');
            run(`ALTER TABLE articles ADD COLUMN is_read INTEGER DEFAULT 0;`);
        }
    } catch (e) {
        console.error('Migration for is_read failed:', e);
    }

    // Migration: Add pdf_context column if it doesn't exist
    try {
        const tableInfo = sqlite!.prepare("PRAGMA table_info(articles)").all() as any[];
        const hasPdfContext = tableInfo.some(col => col.name === 'pdf_context');
        if (!hasPdfContext) {
            console.log('Migrating: Adding pdf_context column to articles table');
            run(`ALTER TABLE articles ADD COLUMN pdf_context TEXT;`);
        }
    } catch (e) {
        console.error('Migration for pdf_context failed:', e);
    }


    run(`
    CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT UNIQUE NOT NULL,
        created_date INTEGER,
        usage_count INTEGER DEFAULT 0
    );
    `);

    run(`
    CREATE TABLE IF NOT EXISTS article_keywords (
        article_id INTEGER,
        keyword_id INTEGER,
        confidence REAL DEFAULT 1.0,
        added_date INTEGER,
        PRIMARY KEY (article_id, keyword_id),
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
        FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
    );
    `);

    run(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER,
        title TEXT DEFAULT 'New Chat',
        created_date INTEGER,
        updated_date INTEGER,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );
    `);

    run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        label TEXT,
        created_date INTEGER,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    `);

    console.log('Database initialized');
}
