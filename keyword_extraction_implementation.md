# Keyword Extraction System: Implementation Plan

## Overview

자동화된 논문 keyword 추출 시스템. LLM 기반 추출과 embedding similarity 기반 매칭을 결합하여, keyword의 일관성을 유지하면서도 각 논문의 고유한 특성을 보존한다.

---

## Problem Statement

### 기존 방식의 문제점
- LLM에게 기존 pool에서 keyword를 선택하도록 하면, 논문이 100개 이상 쌓일 때 모든 keyword가 비슷해짐
- LLM이 "안전한 선택"을 선호하여 broad한 기존 keyword로 수렴
- 각 논문의 고유한 기여(paper-specific contribution)가 사라짐

### 해결 방향
- LLM에게는 pool 참조 없이 자유롭게 추출하도록 함
- Embedding similarity로 수치 기반 매칭 (LLM의 주관적 판단 배제)
- Threshold 기반으로 진짜 동의어만 통합, 나머지는 보존

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Paper Input                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: Free Extraction (LLM)                                  │
│  - Pool 참조 없이 15개 keyword 추출                               │
│  - Established(7-8개) + Contribution(7-8개) 균형                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: Embedding & Matching                                   │
│  - 추출된 15개 keyword embedding 생성                             │
│  - LanceDB에서 기존 pool과 similarity 검색                        │
│  - Threshold(0.88) 초과 시 기존 keyword로 교체                    │
│  - 미달 시 새 keyword로 pool에 추가                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: Deduplication (15 → 10)                                │
│  - 매칭 완료된 15개 내에서 pairwise similarity 계산               │
│  - 가장 유사한 쌍부터 하나씩 제거                                  │
│  - 10개 남을 때까지 반복                                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Output: 10 Keywords + DB Update                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema (LanceDB)

```javascript
// Keywords Table
{
  id: string,           // unique identifier (uuid)
  text: string,         // keyword text
  embedding: float[],   // vector embedding (384 or 768 dimensions)
  usage_count: number,  // 사용된 논문 수
  created_at: date,
  last_used_at: date
}

// Paper_Keywords Table (별도 또는 기존 papers table에 포함)
{
  paper_id: string,
  keyword_ids: string[]  // array of keyword ids
}
```

---

## Algorithm Detail

### Phase 1: Free Extraction

```
Input: Paper (title, abstract, full text or relevant sections)
Output: 15 raw keywords

Process:
1. LLM에 논문 내용과 extraction prompt 전달
2. 15개 keyword를 comma-separated list로 받음
3. 기본 정제: trim, lowercase, 중복 제거
```

### Phase 2: Embedding & Matching

```
Input: 15 raw keywords
Output: 15 matched keywords (일부는 기존 pool keyword로 교체됨)

Process:
For each keyword k:
    1. embedding(k) 생성
    
    2. LanceDB에서 similarity search
       → top 1 result with similarity score
    
    3. If similarity > THRESHOLD (0.88):
         → k를 best_match로 교체
         → best_match의 usage_count 증가
       Else:
         → k를 새 keyword로 pool에 추가
         → usage_count = 1
```

### Phase 3: Deduplication

```
Input: 15 matched keywords
Output: 10 final keywords

Process:
1. 15개 keyword의 pairwise similarity matrix 계산
   (이미 embedding이 있으므로 빠름)

2. While keyword_count > 10:
     - 가장 높은 similarity를 가진 쌍 (ki, kj) 찾기
     - 둘 중 하나 제거:
       * usage_count 낮은 것 제거
       * 같으면 text 길이 긴 것 제거

3. Return remaining 10 keywords
```

---

## LLM Prompt

```
Extract 15 keywords that represent this paper's content.

Guidelines:
- Keywords should be noun phrases (1-4 words typically)
- Avoid overly generic terms that apply to most papers in the field
- Avoid overly specific terms that only make sense within this paper's context

Balance requirement:
- 7-8 keywords: Established concepts, methods, or domains that situate this paper 
  (e.g., "functional connectivity", "treatment-resistant depression", "prefrontal cortex")
- 7-8 keywords: This paper's specific contributions, novel methods, or key findings
  (e.g., "connectivity-guided TMS targeting", "sgACC-evoked BOLD response")

Output format:
Return only the 15 keywords as a comma-separated list, no numbering or categories.
```

---

## Configuration Parameters

```javascript
const CONFIG = {
  // Extraction
  KEYWORDS_TO_EXTRACT: 15,
  KEYWORDS_TO_KEEP: 10,
  
  // Matching
  SIMILARITY_THRESHOLD: 0.88,  // 이 이상이면 같은 keyword로 간주
  
  // Embedding
  EMBEDDING_MODEL: 'Xenova/all-MiniLM-L6-v2',  // 384 dimensions
  // 또는 'Xenova/bge-small-en-v1.5' for better quality
  
  // Pool management
  TARGET_POOL_SIZE_RATIO: 0.2,  // 논문 수 대비 pool 크기 (논문수 / 5)
};
```

---

## JavaScript Libraries

### Core Dependencies

```json
{
  "dependencies": {
    "@lancedb/lancedb": "^0.4.0",
    "@xenova/transformers": "^2.17.0",
    "apache-arrow": "^15.0.0",
    "uuid": "^9.0.0"
  }
}
```

### Library 설명

**@xenova/transformers**
- Browser/Node.js에서 실행 가능한 transformer 모델
- sentence-transformers 호환 모델 사용 가능
- GPU 없이도 동작 (ONNX runtime)

```javascript
import { pipeline } from '@xenova/transformers';

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const embedding = await extractor('functional connectivity', { pooling: 'mean', normalize: true });
// → Float32Array(384)
```

**@lancedb/lancedb**
- Serverless vector database
- Node.js native 지원
- 파일 기반이라 별도 서버 불필요

```javascript
import * as lancedb from '@lancedb/lancedb';

const db = await lancedb.connect('./data/keywords.lance');
const table = await db.openTable('keywords');

// Similarity search
const results = await table.search(queryEmbedding)
  .limit(1)
  .toArray();
```

---

## Implementation Code Structure

```
src/
├── keywords/
│   ├── extractor.js      # LLM keyword extraction
│   ├── embedder.js       # Embedding generation
│   ├── matcher.js        # Similarity matching logic
│   ├── deduplicator.js   # 15 → 10 reduction
│   └── index.js          # Main pipeline
├── db/
│   ├── lancedb.js        # LanceDB connection & operations
│   └── schemas.js        # Table schemas
├── config.js             # Configuration parameters
└── utils/
    └── similarity.js     # Cosine similarity helpers
```

---

## Core Implementation

### embedder.js

```javascript
import { pipeline } from '@xenova/transformers';

let extractor = null;

export async function initEmbedder() {
  if (!extractor) {
    extractor = await pipeline(
      'feature-extraction', 
      'Xenova/all-MiniLM-L6-v2'
    );
  }
  return extractor;
}

export async function embedKeyword(text) {
  const ext = await initEmbedder();
  const result = await ext(text, { 
    pooling: 'mean', 
    normalize: true 
  });
  return Array.from(result.data);
}

export async function embedKeywords(keywords) {
  const embeddings = [];
  for (const kw of keywords) {
    const emb = await embedKeyword(kw);
    embeddings.push({ text: kw, embedding: emb });
  }
  return embeddings;
}
```

### matcher.js

```javascript
import { CONFIG } from '../config.js';
import { searchSimilar, addKeyword, incrementUsage } from '../db/lancedb.js';

export async function matchKeywords(keywordsWithEmbeddings) {
  const matched = [];
  
  for (const { text, embedding } of keywordsWithEmbeddings) {
    const [topMatch] = await searchSimilar(embedding, 1);
    
    if (topMatch && topMatch._distance < (1 - CONFIG.SIMILARITY_THRESHOLD)) {
      // LanceDB returns distance, not similarity
      // distance = 1 - cosine_similarity for normalized vectors
      matched.push({
        text: topMatch.text,
        id: topMatch.id,
        isExisting: true
      });
      await incrementUsage(topMatch.id);
    } else {
      const newId = await addKeyword(text, embedding);
      matched.push({
        text: text,
        id: newId,
        isExisting: false
      });
    }
  }
  
  return matched;
}
```

### deduplicator.js

```javascript
import { cosineSimilarity } from '../utils/similarity.js';
import { getKeywordEmbeddings } from '../db/lancedb.js';

export async function deduplicateKeywords(keywords, targetCount = 10) {
  if (keywords.length <= targetCount) {
    return keywords;
  }
  
  // Get embeddings for all keywords
  const keywordData = await getKeywordEmbeddings(keywords.map(k => k.id));
  
  let remaining = [...keywordData];
  
  while (remaining.length > targetCount) {
    let maxSim = -1;
    let pairToRemove = null;
    
    // Find most similar pair
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const sim = cosineSimilarity(
          remaining[i].embedding, 
          remaining[j].embedding
        );
        if (sim > maxSim) {
          maxSim = sim;
          pairToRemove = [i, j];
        }
      }
    }
    
    // Remove one from the pair (lower usage_count or longer text)
    const [i, j] = pairToRemove;
    const removeIndex = selectForRemoval(remaining[i], remaining[j]);
    remaining.splice(removeIndex === i ? i : j, 1);
  }
  
  return remaining.map(k => ({ text: k.text, id: k.id }));
}

function selectForRemoval(a, b) {
  if (a.usage_count !== b.usage_count) {
    return a.usage_count < b.usage_count ? 0 : 1;
  }
  return a.text.length > b.text.length ? 0 : 1;
}
```

### index.js (Main Pipeline)

```javascript
import { extractKeywordsFromPaper } from './extractor.js';
import { embedKeywords } from './embedder.js';
import { matchKeywords } from './matcher.js';
import { deduplicateKeywords } from './deduplicator.js';
import { CONFIG } from '../config.js';

export async function processKeywords(paper) {
  // Phase 1: Free extraction
  const rawKeywords = await extractKeywordsFromPaper(paper);
  console.log(`Extracted ${rawKeywords.length} keywords`);
  
  // Phase 2: Embedding & Matching
  const withEmbeddings = await embedKeywords(rawKeywords);
  const matched = await matchKeywords(withEmbeddings);
  console.log(`Matched: ${matched.filter(k => k.isExisting).length} existing, ${matched.filter(k => !k.isExisting).length} new`);
  
  // Phase 3: Deduplication
  const final = await deduplicateKeywords(matched, CONFIG.KEYWORDS_TO_KEEP);
  console.log(`Final: ${final.length} keywords`);
  
  return final;
}
```

---

## LanceDB Setup

### lancedb.js

```javascript
import * as lancedb from '@lancedb/lancedb';
import { v4 as uuidv4 } from 'uuid';

let db = null;
let keywordsTable = null;

export async function initDB(dbPath = './data/keywords.lance') {
  db = await lancedb.connect(dbPath);
  
  try {
    keywordsTable = await db.openTable('keywords');
  } catch {
    // Table doesn't exist, create it
    keywordsTable = await db.createTable('keywords', [
      {
        id: 'init',
        text: 'initialization',
        embedding: new Array(384).fill(0),
        usage_count: 0,
        created_at: new Date().toISOString(),
        last_used_at: new Date().toISOString()
      }
    ]);
    // Remove init row
    await keywordsTable.delete('id = "init"');
  }
  
  return keywordsTable;
}

export async function searchSimilar(embedding, limit = 1) {
  const results = await keywordsTable.search(embedding)
    .limit(limit)
    .toArray();
  return results;
}

export async function addKeyword(text, embedding) {
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
  
  return id;
}

export async function incrementUsage(id) {
  // LanceDB update
  await keywordsTable.update({
    where: `id = "${id}"`,
    values: {
      usage_count: { $inc: 1 },
      last_used_at: new Date().toISOString()
    }
  });
}

export async function getKeywordEmbeddings(ids) {
  const results = await keywordsTable
    .filter(`id IN (${ids.map(id => `"${id}"`).join(',')})`)
    .toArray();
  return results;
}
```

---

## Utility Functions

### similarity.js

```javascript
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (normA * normB);
}
```

---

## Testing Strategy

### Unit Tests

```javascript
// test/matcher.test.js
describe('Keyword Matching', () => {
  it('should match highly similar keywords', async () => {
    // "fMRI" and "functional MRI" should match
  });
  
  it('should not match different concepts', async () => {
    // "sgACC targeting" and "motor cortex" should not match
  });
  
  it('should respect threshold', async () => {
    // Similarity 0.87 should not match with threshold 0.88
  });
});
```

### Integration Test

```javascript
// test/pipeline.test.js
describe('Full Pipeline', () => {
  it('should process first paper correctly', async () => {
    // First paper: all keywords should be new
  });
  
  it('should reuse existing keywords when appropriate', async () => {
    // Similar paper: some keywords should match existing
  });
  
  it('should preserve unique contributions', async () => {
    // Paper-specific keywords should survive
  });
});
```

---

## Monitoring & Debugging

### Pool Statistics

```javascript
export async function getPoolStats() {
  const all = await keywordsTable.toArray();
  
  return {
    totalKeywords: all.length,
    avgUsageCount: all.reduce((sum, k) => sum + k.usage_count, 0) / all.length,
    singleUseKeywords: all.filter(k => k.usage_count === 1).length,
    topKeywords: all.sort((a, b) => b.usage_count - a.usage_count).slice(0, 20)
  };
}
```

### Per-Paper Logging

```javascript
// 각 논문 처리 후 로그
{
  paper_id: "xxx",
  extracted: 15,
  matched_existing: 8,
  added_new: 7,
  after_dedup: 10,
  final_keywords: ["...", "..."],
  pool_size_after: 1234
}
```

---

## Tuning Guidelines

### Threshold 조정

```
증상: 너무 많은 keyword가 기존 것으로 교체됨
→ SIMILARITY_THRESHOLD 올리기 (0.88 → 0.92)

증상: 동의어가 따로 존재함 ("fMRI", "functional MRI" 별개)
→ SIMILARITY_THRESHOLD 내리기 (0.88 → 0.85)
```

### Pool 크기 모니터링

```
목표: pool_size ≈ 논문수 / 5

Pool이 너무 빠르게 커지면:
→ SIMILARITY_THRESHOLD 낮추기
→ 또는 초기 논문들의 keyword가 너무 specific할 수 있음

Pool이 너무 작으면:
→ SIMILARITY_THRESHOLD 높이기
→ 또는 논문들이 너무 비슷한 분야일 수 있음
```

---

## Future Improvements

1. **Batch Processing**: 여러 논문 동시 처리 시 embedding 배치 생성

2. **Hierarchical Keywords**: broad/narrow 관계 저장

3. **Synonym Table**: 명시적 동의어 매핑 (user-defined)

4. **Keyword Quality Score**: usage_count + recency + specificity 종합 점수

5. **Auto Threshold Tuning**: pool 크기 기반 threshold 자동 조정
