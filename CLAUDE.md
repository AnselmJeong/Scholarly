# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scholarly is an Electron desktop application for managing academic PDF articles with AI-powered keyword extraction and chat capabilities. It enables researchers to organize papers via keywords fetched from OpenAlex, filter/search collections, and chat with papers using a local Ollama LLM.

## Commands

```bash
# Development
npm run dev          # Start Vite dev server + Electron

# Build
npm run build        # TypeScript compile + Vite build + electron-builder

# Lint
npm run lint         # ESLint with TypeScript
```

## Architecture

### Process Model (Electron)

```
┌─────────────────────────────────────────────────────┐
│  Renderer Process (React)                           │
│  src/App.tsx + components/                          │
│  - UI state, filtering, user interactions           │
│  - Communicates via window.ipcRenderer              │
└─────────────────────────────────────────────────────┘
        ↕ IPC Handlers (invoke/on)
┌─────────────────────────────────────────────────────┐
│  Main Process (Node)                                │
│  electron/main.ts                                   │
│  - File watching (chokidar)                         │
│  - SQLite database (better-sqlite3 + Drizzle ORM)   │
│  - PDF processing, OpenAlex API, Ollama chat        │
└─────────────────────────────────────────────────────┘
```

### Key Data Flow

1. User selects root folder → FileWatcher starts monitoring
2. New PDF detected → Article record created in SQLite
3. `processFile()` queries OpenAlex for metadata + keywords
4. Keywords linked to articles via `article_keywords` junction table
5. UI filters articles by keyword selection (AND logic)

### Directory Structure

- `src/` - React frontend (components, App.tsx)
- `electron/` - Main process code
  - `main.ts` - IPC handlers, window management, file processing
  - `db/` - SQLite schema (Drizzle) and initialization
  - `services/` - AI (Ollama), PDF extraction, OpenAlex, BibTeX
  - `store.ts` - Settings persistence

### Database Schema

Four main tables in SQLite:
- `articles` - PDF metadata (title, authors, year, DOI, abstract, file path)
- `keywords` - Unique keywords with usage counts
- `article_keywords` - Many-to-many linking
- `chat_sessions` / `chat_messages` - Per-article chat history

### External Integrations

- **OpenAlex API** - Fetches paper metadata and keywords by title search
- **Ollama** - Local LLM (default: mistral-large) for paper Q&A chat
- **Crossref** - BibTeX export fetches citation data

## Key Implementation Details

### File Move Detection

Uses MD5 hash matching within 3-second window to distinguish file moves from delete+add.

### PDF Context Caching

Full PDF text extracted on-demand (not stored in DB). LRU cache of 20 papers kept in memory for chat sessions.

### Keyword Filtering

Frontend implements AND logic: selecting multiple keywords shows only articles containing ALL selected keywords. The `filteredKeywords` memo recalculates available keywords based on current article set.

### IPC Patterns

All main process functions exposed via `ipcMain.handle()`. Renderer calls `window.ipcRenderer.invoke('handler-name', args)`. Data refresh triggered by `win.webContents.send('data-updated')`.

## Path Alias

`@/` maps to `src/` (configured in tsconfig.json and vite.config.ts).
