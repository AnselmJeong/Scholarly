import { sqliteTable, integer, text, real, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const articles = sqliteTable('articles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filename: text('filename').notNull(),
  filePath: text('file_path').notNull().unique(),
  title: text('title'),
  authors: text('authors'),
  year: integer('year'),
  journal: text('journal'),
  doi: text('doi'),
  metadataSource: text('metadata_source'),
  abstract: text('abstract'),
  addedDate: integer('added_date', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  lastModified: integer('last_modified', { mode: 'timestamp' }),
  fileHash: text('file_hash'),
  fileSize: integer('file_size'),
  isKey: integer('is_key').default(0),
  isRead: integer('is_read').default(0),
  pdfContext: text('pdf_context')  // Cached extracted PDF text
});

export const keywords = sqliteTable('keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword').notNull().unique(),
  createdDate: integer('created_date', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  usageCount: integer('usage_count').default(0)
});

export const articleKeywords = sqliteTable('article_keywords', {
  articleId: integer('article_id').references(() => articles.id, { onDelete: 'cascade' }),
  keywordId: integer('keyword_id').references(() => keywords.id, { onDelete: 'cascade' }),
  confidence: real('confidence').default(1.0),
  addedDate: integer('added_date', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`)
}, (t) => ({
  pk: primaryKey({ columns: [t.articleId, t.keywordId] })
}));

export const chatSessions = sqliteTable('chat_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  articleId: integer('article_id').references(() => articles.id, { onDelete: 'cascade' }),
  title: text('title').default("New Chat"),
  createdDate: integer('created_date', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedDate: integer('updated_date', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`)
});

export const chatMessages = sqliteTable('chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id').references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  label: text('label'), // Optional label for hidden prompts
  createdDate: integer('created_date', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`)
});
