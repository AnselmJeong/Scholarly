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
  abstract: text('abstract'),
  addedDate: integer('added_date', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  lastModified: integer('last_modified', { mode: 'timestamp' }),
  fileHash: text('file_hash'),
  fileSize: integer('file_size'),
  isKey: integer('is_key').default(0)
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
