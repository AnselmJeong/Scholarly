# Scholarly Native

Rust + GPUI Kit로 만든 macOS arm64 앱이다. Electron·Chromium·Node·Python을 배포 앱에 포함하지 않는다. PDFKit·CoreGraphics를 사용하는 작은 Swift 도우미를 포함한다. 앱의 외곽 UI는 GPUI Kit이며, 학습 노트는 macOS의 WKWebView에서 HTML로 표시한다. KaTeX와 수식 글꼴은 오프라인으로 내장한다. Codex와 Claude 구독 연결에는 각각 설치된 공식 CLI를 이용한다.

## 구현된 기능

- 원래 Scholarly의 남색 3단 화면: 키워드·폴더 탐색, 정렬 가능한 논문 표, 오른쪽 상세 정보·질문·메모. 패널 폭 조절·저장, 좁은 창의 상세 화면 전환, Lapis Dark 읽기 배경.
- 기존 SQLite 서재·읽음·중요 표시·키워드·대화 이관, 폴더 열기·감시·검색·가상화 목록. 저장된 목록을 먼저 표시하고 폴더 변경 확인은 뒤에서 수행한다.
- 충분한 설명을 제공하는 학습 노트, 점진 표시, 명시적 추론 강도, PDF/근거 캐시, 긴 문서 분할 처리.
- 기존 노트 재작성, 취소, 이전 버전 복구, 개인 메모 자동 저장. 실패·취소한 부분 응답은 저장하지 않는다.
- 현재 폴더의 없는 노트 작성 또는 전체 재작성 계획, 최대 두 편 동시 처리, 진행 기록 저장과 재개.
- 원문 대조와 본문·원문 해시에 연결된 대조 결과, 논문 질문·대화 기록.
- 선택·복사 가능한 HTML 본문·비교표, KaTeX 블록/인라인 수식, 본문 크기 조절, 밝은/어두운 화면.
- 원문의 그림·표를 번호와 캡션으로 찾아 개별 영역으로 자동 추출하고, 그림은 해당 번호를 설명하는 본문 문단 옆에, 표는 문단 아래에 넓게 배치. 좁은 읽기 폭·큰 글자에서는 그림도 설명 바로 아래로 이동. 클릭 확대·축소, 원문 쪽 열기, 여러 쪽에 걸친 표 지원. 기존 수동 크롭도 보존.
- 이미지와 수식을 포함하는 독립 HTML, 현재 목록 BibTeX, 논문 PDF·노트·그림·서지정보 ZIP.
- 논문 정보 편집, DOI로 Crossref 정보 조회 후 확인·저장.

앱 화면과 HTML 내보내기는 같은 렌더러를 사용한다. 추가 AI 호출 없이 기존 노트에도 수식과 자동 추출 자료를 표시한다. 저장 형식은 호환성을 위해 Markdown을 유지한다. 원문 표는 수치·각주를 그대로 보존한 이미지, 노트의 설명용 표는 HTML 표로 표시한다. 임의 HTML·스크립트·외부 이미지 요청은 차단한다. 추출 경계가 불확실하면 페이지 전체를 그림처럼 펼쳐 놓지 않고 원문 확인 항목으로 접어 둔다. 수식 변환 실패는 해당 위치에 알린다.

## 빌드와 실행

현재 버전은 **0.10.4 (build 14)**이다. Rust 1.99.0, Python 3.11 이상, Xcode Command Line Tools가 필요하다. Typst 설치는 필요하지 않다. `Cargo.lock`을 포함한다. 저장소 루트에서:

```sh
cargo +1.99.0 test --manifest-path native/Cargo.toml
cargo +1.99.0 clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
python3 scripts/native-notices.py
bash scripts/package-native.sh release
python3 scripts/check-source-visuals.py native/target/pdf-helper
swiftc -O native/platform/reader-check.swift -o native/target/reader-check
```

결과는 `native/target/Scholarly Native.app`이다. `gpui-kit = 0.9.1`과 시스템 WebKit 연결용 `wry`를 사용하며, Chromium은 포함하지 않는다. `scripts/package-native.sh`는 Cargo manifest에서 버전과 빌드 번호를 읽고, 도우미와 앱을 로컬 실행용으로 서명한 뒤 서명을 검사한다. `SCHOLARLY_SIGN_IDENTITY`를 지정하면 기존 개발 인증서로 서명하며, 생략하면 임시 서명을 사용한다. 이 로컬 후보는 Developer ID 공증 배포본이 아니다.

개발 확인용 명령(결과 디렉터리는 원본과 분리):

```sh
"native/target/Scholarly Native.app/Contents/MacOS/Scholarly" --evaluate "/path/paper.pdf" "/path/evaluation"
"native/target/Scholarly Native.app/Contents/MacOS/Scholarly" --export-html "/path/paper.pdf" "/path/note.html"
```

`--evaluate`는 실제 선택된 공급자에 원문을 보내며 노트를 새로 작성한다. `SCHOLARLY_EVAL_MODEL`로 모델을 지정할 수 있다. `SCHOLARLY_EVAL_REVIEW=1`은 추가 원문 대조를 실행한다.

## 데이터와 복구

원본 데이터: `~/Library/Application Support/Scholarly/`. 네이티브 데이터: `~/Library/Application Support/Scholarly Native/`. 최초 실행에 SQLite 온라인 백업을 만들고 무결성을 검사한다. 두 앱의 DB는 분리되어 있으며 이후 변경을 자동 병합하지 않는다. 원본 PDF는 읽기만 한다.

노트는 PDF 옆 `summary/<이름>.learning.md`에 저장한다. 기존 `summary/<이름>.md`도 읽을 수 있으며 원문 대조를 거친 기존 문서의 저장 규칙을 바꾸지 않는다. `.previous`와 `.history/`에 이전 버전을 보관한다. `.figures.json`, `.assets/`는 사용자가 보관한 원문 그림, `.review.json`은 원문 대조 기록이다. 자동 추출 자료는 네이티브 데이터 폴더의 `source-visuals-v2/<PDF SHA-256>/`에 캐시하며 원문 파일은 변경하지 않는다. 개인 메모는 별도 DB 테이블에 저장한다. 이전 버전 복구도 현재 결과를 백업한 뒤 수행한다.

Codex·Claude 자격증명은 공식 CLI의 저장소를 그대로 사용한다. 기존 Electron의 암호화된 Ollama API 키를 임의 해독하지 않는다. 필요한 경우 설정에서 키를 입력하면 해당 서버 주소별 macOS Keychain 항목으로 저장한다. 다른 제공자나 API 과금 경로로 자동 전환하지 않는다.

## 검증 상태와 제한

0.10.3의 [문단 옆 그림 배치 검증](../docs/evaluation/2026-11-14-adjacent-figures.md)은 Rust 검사 13개와 실제 논문 7편의 26개 설명 묶음·30개 그림을 포함한다. 780px·420px·큰 글자 상태를 확인했다.

0.10.2의 검증 결과와 재현 명령은 [HTML 읽기 화면 평가](../docs/evaluation/2026-11-14-html-reader.md)에 있다. Rust 회귀 검사 11개, Clippy, 합성 PDF의 추출 경계 검사, 실제 논문 7편의 HTML·수식·그림·표 검사를 수행했다. 이전 생성 품질·속도·데이터 이관 검증은 [학습 노트 평가](../docs/evaluation/2026-11-13-learning-native.md)에 별도로 보존한다.

- PDF의 텍스트 캡션과 이미지·벡터 선·표 격자 위치를 이용하는 자동 추출이다. 모든 출판사 레이아웃이나 스캔 PDF의 성공을 보장하지 않는다. 텍스트가 없는 스캔은 OCR 사본이 필요하다.
- 이미지의 의미를 새로 판독하거나 원문 표를 임의로 재입력하지 않는다. 정확한 Figure/Table 번호가 없는 문단에는 추측하여 그림을 연결하지 않고 노트 아래의 자료 목록에 둔다.
- 원본 Electron DB와 네이티브 DB는 분리되며, 두 앱 사이의 이후 변경을 자동 병합하지 않는다.
- 시스템 WebKit 프로세스를 사용한다. 앱 번들 크기는 실행 중 메모리 사용량이나 기동 시간과 다르며, 1초 기동·100ms 전환 목표는 별도 측정이 필요하다.

0.10.4는 종이색/야간 읽기 화면, 수식 구분자 복구, 원문 표·그림 추출, 제공자별 모델 드롭다운과 작성 언어 표시를 개선했다. [검증 기록](../docs/evaluation/2026-11-14-reader-polish.md)을 참고한다.
