# Product Requirements Document (PRD)

# Academic Article Keyword Management System

## 1. Product Overview

### 1.1 Product Vision

학술 논문(PDF)을 효율적으로 관리하고 검색할 수 있는 키워드 기반 데스크톱 애플리케이션. Zotero의 장점을 계승하되, 더 넓은(broad) 키워드 체계를 통해 실질적인 논문 세트 발견과 관리를 가능하게 함.

### 1.2 Target Users

- 대학원생 및 연구자
- 다수의 학술 논문을 관리하는 학자
- 문헌 리뷰를 수행하는 연구팀

### 1.3 Core Value Proposition

- **지능형 키워드 관리**: 기존 키워드 우선 활용으로 일관성 유지
- **효율적인 논문 발견**: 다중 키워드 필터링을 통한 점진적 탐색
- **자동 동기화**: 파일 시스템 변경 자동 감지 및 반영
- **배치 내보내기**: 선택된 논문 세트의 간편한 공유

---

## 2. Functional Requirements

### 2.1 File System Monitoring

#### FR-2.1.1 폴더 감시

- **기능**: 사용자가 지정한 root 폴더를 재귀적으로 감시
- **대상**: PDF 파일만 추적
- **동작**:
  - 새 PDF 추가 시: 자동 인덱싱 트리거
  - PDF 삭제 시: DB에서 관련 레코드 제거
  - PDF 이동 시: 경로 정보 업데이트
  - 파일명 변경 시: 메타데이터 업데이트

#### FR-2.1.2 초기 스캔

- 앱 시작 시 또는 root 폴더 설정 시 전체 PDF 스캔
- 진행 상황 표시 (진행률 바 + 현재 처리 중인 파일명)

### 2.2 Keyword Extraction & Management

#### FR-2.2.1 AI 기반 키워드 추출

- **입력**: PDF 파일 (텍스트 추출 가능)
- **처리 과정**:
  1. PDF 텍스트 추출 (제목, 초록, 본문 앞부분)
  2. 기존 키워드 DB 로드
  3. Claude API 호출:
     - 프롬프트: "기존 키워드 목록을 우선 사용하여 이 논문을 색인하세요. 적합한 기존 키워드가 없을 때만 새 키워드(broad, 일반적)를 제안하세요."
     - 기존 키워드 목록 제공
     - 논문 내용 제공
  4. 응답 파싱 및 검증
- **출력**:
  - 선택된 기존 키워드 목록 (3-10개)
  - 필요 시 새 키워드 제안 (1-3개)

#### FR-2.2.2 사용자 승인 워크플로우

- 자동 추출된 키워드 표시
- 사용자 옵션:
  - 승인 (Enter 또는 확인 버튼)
  - 수정 (키워드 추가/제거/변경)
  - 건너뛰기 (나중에 처리)
- 새 키워드 제안 시 명확히 표시 (예: "NEW" 배지)

#### FR-2.2.3 키워드 정규화

- 대소문자 통일 (Title Case)
- 복수형/단수형 통합 옵션
- 동의어 매핑 (선택적 기능)

### 2.3 Database Schema

#### Articles Table

```sql
CREATE TABLE articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_path TEXT UNIQUE NOT NULL,
    title TEXT,
    authors TEXT,
    year INTEGER,
    abstract TEXT,
    added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_modified DATETIME,
    file_hash TEXT,
    file_size INTEGER
);
```

#### Keywords Table

```sql
CREATE TABLE keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT UNIQUE NOT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    usage_count INTEGER DEFAULT 0
);
```

#### Article_Keywords Table (Many-to-Many)

```sql
CREATE TABLE article_keywords (
    article_id INTEGER,
    keyword_id INTEGER,
    confidence REAL DEFAULT 1.0,
    added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, keyword_id)
);
```

### 2.4 User Interface

#### FR-2.4.1 메인 윈도우 레이아웃 (3-Panel Design)

**좌측 패널: Keyword Browser (Zotero 스타일)**

- 계층 구조:
  
  ```
  📁 My Library (전체: 247개)  📁 Selected Keywords (현재 필터: 12개)  🏷️ Neuroscience (89)  🏷️ Computational Neuroscience (45)  🏷️ Free Energy Principle (23)  🏷️ Active Inference (18)  ...
  ```

- 각 키워드 옆에 논문 개수 표시

- 다중 선택 가능 (Cmd+Click, Shift+Click)

- 검색 바 (키워드 필터링)

**중앙 패널: Article List**

- 표 형식:
  | Title | Authors | Year | Keywords (태그 형식) | Path |
- 정렬 옵션: 제목, 저자, 연도, 추가 날짜
- 체크박스 선택 (배치 작업용)
- 더블클릭 시 PDF 열기

**우측 패널: Detail View / Keyword Suggestion**

- 선택된 논문 정보:
  - 제목, 저자, 연도
  - 초록 (있는 경우)
  - 할당된 키워드 (편집 가능)
  - 파일 경로
- 추천 키워드 섹션:
  - "현재 선택된 논문들의 공통 키워드"
  - 클릭으로 필터에 추가

#### FR-2.4.2 키워드 필터링 로직

1. **단일 키워드 선택**: 해당 키워드를 가진 모든 논문 표시
2. **다중 키워드 선택**:
   - AND 로직 (기본): 모든 선택된 키워드를 포함하는 논문
   - OR 로직 (옵션): 하나 이상의 키워드를 포함하는 논문
3. **점진적 필터링**:
   - 키워드 A 선택 → 결과 논문 세트의 다른 키워드들이 추천으로 표시
   - 키워드 B 추가 선택 → 결과 세트가 좁혀지며, 새로운 추천 키워드 업데이트

#### FR-2.4.3 상단 툴바

- 🏠 Root 폴더 설정/변경
- 🔄 수동 재스캔
- ➕ 논문 수동 추가
- 🏷️ 선택된 논문에 키워드 일괄 추가/제거
- 📦 Export to ZIP
- ⚙️ 설정

### 2.5 Export Functionality

#### FR-2.5.1 ZIP 내보내기

- **트리거**:
  - 툴바의 "Export" 버튼
  - 컨텍스트 메뉴 (우클릭)
- **대상**:
  - 현재 필터링된 논문 세트
  - 또는 수동 선택된 논문들
- **옵션**:
  - 원본 파일명 유지 vs. 정규화된 파일명 (Title_Author_Year.pdf)
  - 폴더 구조 보존 vs. 플랫 구조
  - 메타데이터 파일 포함 (CSV 또는 JSON)
- **프로세스**:
  1. 저장 위치 선택 (Save Dialog)
  2. 진행 상황 표시
  3. 완료 알림 + "Show in Finder" 옵션

### 2.6 Settings & Preferences

#### FR-2.6.1 일반 설정

- Root 폴더 경로
- 자동 스캔 활성화/비활성화
- 스캔 제외 폴더 지정

#### FR-2.6.2 AI 설정

- Claude API 키 입력
- 모델 선택 (Sonnet, Opus)
- 키워드 개수 범위 (최소-최대)
- 자동 승인 모드 (AI 결과를 즉시 적용)

#### FR-2.6.3 UI 설정

- 테마 (라이트/다크)
- 폰트 크기
- 패널 너비 조정

---

## 3. Non-Functional Requirements

### 3.1 Performance

- **PDF 처리 속도**: 논문 1개당 평균 5초 이하
- **UI 반응성**: 1000개 논문까지 렉 없이 필터링
- **DB 쿼리**: 복잡한 키워드 필터링도 100ms 이하

### 3.2 Scalability

- 10,000개 논문까지 안정적 처리
- SQLite FTS (Full-Text Search) 활용

### 3.3 Reliability

- 파일 시스템 변경 100% 감지
- DB 트랜잭션 안정성
- 크래시 복구: 자동 백업 및 복원

### 3.4 Security

- API 키 암호화 저장 (macOS Keychain 사용)
- 로컬 데이터만 처리 (프라이버시 보장)

### 3.5 Usability

- 직관적인 Zotero-like 인터페이스
- 온보딩 튜토리얼
- 키보드 단축키 지원

---

## 4. Technical Architecture

### 4.1 Technology Stack

#### Frontend

- **Framework**: Electron (macOS 네이티브 빌드)
- **UI Library**: React 18 + TypeScript
- **State Management**: Zustand 또는 Redux Toolkit
- **Styling**: Tailwind CSS + Shadcn/ui

#### Backend (Electron Main Process)

- **Runtime**: Node.js
- **Database**: SQLite (better-sqlite3)
- **File Watching**: chokidar
- **PDF Processing**: pdf-parse 또는 pdf.js
- **AI Integration**: Anthropic SDK (Claude API)

#### Build & Package

- **Bundler**: Vite
- **Packager**: electron-builder (DMG 생성)

### 4.2 Data Flow

```
1. File System Event (PDF 추가/삭제)
   ↓
2. Chokidar → IPC → Main Process
   ↓
3. PDF Text Extraction
   ↓
4. Claude API Call (with existing keywords)
   ↓
5. Parse Response → User Approval Dialog
   ↓
6. Update SQLite DB
   ↓
7. IPC → Renderer Process → UI Update
```

### 4.3 Key Modules

#### Module 1: FileSystemWatcher

- 책임: root 폴더 감시, 변경 이벤트 발생
- 기술: chokidar

#### Module 2: PDFProcessor

- 책임: PDF 텍스트 추출, 메타데이터 파싱
- 기술: pdf-parse

#### Module 3: KeywordEngine

- 책임: Claude API 호출, 키워드 추출 로직
- 입력: PDF 텍스트 + 기존 키워드 목록
- 출력: 추천 키워드 + 신규 키워드 제안

#### Module 4: DatabaseManager

- 책임: SQLite CRUD, 쿼리 최적화
- ORM: Kysely 또는 Drizzle

#### Module 5: ExportService

- 책임: ZIP 생성, 메타데이터 내보내기

---

## 5. User Stories

### US-1: 초기 설정

> **As a** 연구자  
> **I want to** root 폴더를 지정하고 초기 스캔을 수행하여  
> **So that** 모든 기존 논문이 자동으로 인덱싱된다.

**Acceptance Criteria**:

- [ ] 폴더 선택 다이얼로그가 표시된다
- [ ] 진행률 바가 표시된다
- [ ] 각 PDF에 대해 키워드 승인 UI가 표시된다

### US-2: 논문 추가 감지

> **As a** 사용자  
> **I want to** 새 PDF를 폴더에 넣으면 자동으로 인덱싱되도록  
> **So that** 수동 작업 없이 라이브러리가 최신 상태를 유지한다.

**Acceptance Criteria**:

- [ ] 3초 이내에 새 파일이 감지된다
- [ ] 알림이 표시된다 ("New article detected: ...")
- [ ] 키워드 할당 다이얼로그가 나타난다

### US-3: 키워드 기반 필터링

> **As a** 연구자  
> **I want to** "Free Energy Principle"과 "Neuroscience" 키워드를 선택하여  
> **So that** 두 키워드를 모두 가진 논문만 볼 수 있다.

**Acceptance Criteria**:

- [ ] 다중 키워드 선택이 가능하다
- [ ] AND/OR 토글이 제공된다
- [ ] 실시간으로 결과가 업데이트된다
- [ ] 추천 키워드가 우측에 표시된다

### US-4: 논문 세트 내보내기

> **As a** 연구팀 리더  
> **I want to** 선택된 15개 논문을 ZIP으로 묶어  
> **So that** 팀원들에게 공유할 수 있다.

**Acceptance Criteria**:

- [ ] 체크박스로 논문 선택이 가능하다
- [ ] "Export to ZIP" 버튼이 활성화된다
- [ ] 파일명 옵션을 선택할 수 있다
- [ ] ZIP 파일이 생성되고 Finder에서 열린다

### US-5: 키워드 편집

> **As a** 사용자  
> **I want to** 잘못 할당된 키워드를 수정하거나  
> **So that** 논문 분류 정확도를 높일 수 있다.

**Acceptance Criteria**:

- [ ] 논문 선택 시 우측에 키워드 태그가 표시된다
- [ ] 태그를 클릭해 제거할 수 있다
- [ ] 새 키워드를 타이핑하여 추가할 수 있다
- [ ] 변경사항이 즉시 DB에 저장된다



**Bib export**

얻어진 set에 대해, crossref를 검색해서 abstract가 표함된 BibTeX file을 생성할 수 있는 기능

---

## 6. UI Mockups (Text-Based)

### 메인 윈도우

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🏠 ~/Documents/Papers  🔄 ➕ 🏷️ 📦 ⚙️              🔍 Search       │
├──────────────┬──────────────────────────────────┬───────────────────┤
│              │                                  │                   │
│ 📁 My Lib... │ Title            | Authors | ... │ Selected Article  │
│ 🏷️ Neuro... │ ═══════════════════════════════  │ ───────────────── │
│   (89)       │ □ Biomimetic...  | Pathak  |... │ Title: Bio...     │
│              │ □ Free Energy... | Friston |... │ Authors: A, B     │
│ 🏷️ Computa..│ □ Active Infer...| Parr    |... │ Year: 2025        │
│   (45)       │                  |         |... │                   │
│              │                                  │ Keywords:         │
│ 🏷️ FEP (23) │                                  │ [Neuroscience] ×  │
│              │                                  │ [FEP] ×           │
│ 🏷️ Active...│                                  │ [+ Add]           │
│   (18)       │                                  │                   │
│              │                                  │ Path: ~/Docs/...  │
│              │                                  │                   │
│              │                                  │ Common Keywords:  │
│              │                                  │ • Basal Ganglia   │
│              │                                  │ • Striatum        │
│              │                                  │                   │
└──────────────┴──────────────────────────────────┴───────────────────┘
```

### 키워드 승인 다이얼로그

```
┌───────────────────────────────────────────────────┐
│ Keyword Assignment for:                          │
│ "Biomimetic model of corticostriatal..."         │
├───────────────────────────────────────────────────┤
│                                                   │
│ Suggested Keywords (from existing):              │
│  ☑ Corticostriatal circuit                       │
│  ☑ Computational Neuroscience                    │
│  ☑ Neural code                                   │
│  ☑ Working memory                                │
│  ☐ Reinforcement learning                        │
│                                                   │
│ New Keywords (proposed):                          │
│  ☑ Incongruent neurons  [NEW]                    │
│  ☐ Biomimetic modeling  [NEW]                    │
│                                                   │
│ [✏️ Edit] [Skip] [Approve]                       │
└───────────────────────────────────────────────────┘
```

---

## 7. Implementation Phases

### Phase 1: MVP (4-6 weeks)

- [ ] Electron 앱 기본 구조
- [ ] SQLite DB 설정
- [ ] 단일 폴더 스캔 (재귀 없이)
- [ ] Claude API 통합 (기본 키워드 추출)
- [ ] 간단한 3-패널 UI
- [ ] 키워드 필터링 (AND 로직만)
- [ ] ZIP 내보내기 (기본 기능)

### Phase 2: Core Features (3-4 weeks)

- [ ] 재귀적 폴더 감시 (chokidar)
- [ ] 실시간 파일 변경 감지
- [ ] 키워드 승인 워크플로우
- [ ] 추천 키워드 시스템
- [ ] AND/OR 필터 토글
- [ ] 논문 상세 정보 패널

### Phase 3: Polish & Advanced Features (2-3 weeks)

- [ ] 다크 모드
- [ ] 키보드 단축키
- [ ] 설정 UI
- [ ] 온보딩 튜토리얼
- [ ] 성능 최적화 (큰 라이브러리 대응)
- [ ] 에러 핸들링 및 로깅

### Phase 4: Testing & Release (1-2 weeks)

- [ ] 단위 테스트 (주요 모듈)
- [ ] E2E 테스트 (Playwright)
- [ ] 베타 테스터 피드백 수집
- [ ] DMG 빌드 및 코드 서명
- [ ] 문서 작성 (README, 사용 가이드)

---

## 8. Success Metrics

### Quantitative

- **도입률**: 초기 타겟 100명 사용자
- **논문 처리량**: 사용자당 평균 500개 이상
- **키워드 재사용률**: 신규 논문의 80% 이상이 기존 키워드로 색인
- **사용 빈도**: 주 3회 이상 활성 사용

### Qualitative

- **사용자 만족도**: 4.5/5.0 이상 (설문)
- **NPS (Net Promoter Score)**: 50 이상
- **핵심 피드백**: "Zotero보다 키워드가 유용하다"

---

## 9. Risk & Mitigation

| Risk                   | Probability | Impact | Mitigation                            |
| ---------------------- | ----------- | ------ | ------------------------------------- |
| Claude API 비용 초과       | Medium      | High   | 요청 캐싱, 배치 처리, 사용자별 할당량 설정             |
| PDF 텍스트 추출 실패 (스캔 이미지) | High        | Medium | OCR 라이브러리 통합 (Tesseract.js) 또는 사용자 알림 |
| 대용량 라이브러리 성능 저하        | Medium      | High   | 가상 스크롤, 인덱싱 최적화, Web Worker 활용        |
| 키워드 일관성 부족             | Medium      | Medium | 정기적인 키워드 정리 도구, 동의어 맵핑                |
| 파일 시스템 권한 문제 (macOS)   | Low         | High   | 첫 실행 시 권한 요청 가이드, 샌드박스 예외 처리          |

---

## 10. Future Enhancements (Post-MVP)

### 10.1 Advanced Features

- **AI 채팅**: "이 논문과 유사한 다른 논문 찾아줘" (RAG 기반)
- **자동 분류**: 키워드를 폴더로 변환하는 "Smart Folder" 기능
- **협업**: 키워드 DB를 팀원과 공유 (클라우드 동기화)
- **인용 네트워크**: 논문 간 인용 관계 시각화

### 10.2 Cross-Platform

- MacOS 지원

### 10.3 Integration

- 

---

## 11. Open Questions

1. **키워드 개수 제한**: 논문당 최소/최대 키워드 개수는? (현재 제안: 3-10개)
2. **신규 키워드 승인 프로세스**: 자동 승인
3. **키워드 계층 구조**: Flat 구조
4. **멀티 루트 폴더**: root folder 내의 모든 subfolder structure 동시 감시

---

## 12. Appendix

### 12.1 Glossary

- **Broad Keyword**: 여러 논문에 적용 가능한 일반적 키워드 (예: "Neuroscience" vs. "Parvalbumin-expressing interneurons")
- **Keyword Reuse Rate**: (기존 키워드 사용 횟수) / (전체 키워드 할당 횟수)
- **Progressive Filtering**: 키워드를 하나씩 추가하며 결과를 좁혀가는 탐색 방식

### 12.2 References

- Zotero UI Patterns
- Ollama API Documentation
- Electron Best Practices


