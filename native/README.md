# Scholarly Native

Rust + GPUI Kit로 만든 macOS arm64 앱이다. Electron·Chromium·Node·Python을 배포 앱에 포함하지 않는다. PDFKit을 사용하는 작은 Swift 도우미와 LaTeX를 SVG로 표시하는 Typst 도구를 포함한다. Codex와 Claude 구독 연결에는 각각 설치된 공식 CLI를 이용한다.

## 구현된 기능

- 원래 Scholarly의 남색 3단 화면: 키워드·폴더 탐색, 정렬 가능한 논문 표, 오른쪽 상세 정보·질문·메모. 패널 폭 조절·저장, 좁은 창의 상세 화면 전환, Lapis Dark 읽기 배경.
- 기존 SQLite 서재·읽음·중요 표시·키워드·대화 이관, 폴더 열기·감시·검색·가상화 목록. 저장된 목록을 먼저 표시하고 폴더 변경 확인은 뒤에서 수행한다.
- 충분한 설명을 제공하는 학습 노트, 점진 표시, 명시적 추론 강도, PDF/근거 캐시, 긴 문서 분할 처리.
- 기존 노트 재작성, 취소, 이전 버전 복구, 개인 메모 자동 저장. 실패·취소한 부분 응답은 저장하지 않는다.
- 현재 폴더의 없는 노트 작성 또는 전체 재작성 계획, 최대 두 편 동시 처리, 진행 기록 저장과 재개.
- 원문 대조와 본문·원문 해시에 연결된 대조 결과, 논문 질문·대화 기록.
- 선택·복사 가능한 본문, 수식 SVG, 표, 본문 크기 조절, 밝은/어두운 화면.
- 원문 페이지 확인, 그림 영역 드래그 선택, 절에 연결한 그림과 설명 배치. 재작성 시 그림 보존.
- 이미지와 수식을 포함하는 독립 HTML, 현재 목록 BibTeX, 논문 PDF·노트·그림·서지정보 ZIP.
- 논문 정보 편집, DOI로 Crossref 정보 조회 후 확인·저장.

HTML 내보내기는 추가 AI 호출 없이 동작한다. 임의 HTML·스크립트와 외부 이미지 요청을 차단하고 앱이 연결한 원문 그림만 포함한다. 그림 자동 추출·판독은 기본 생성 경로에 포함하지 않는다. 수식 변환에 실패하면 해당 수식을 원문 표기로 보여 주며 실패 상태를 알린다.

## 빌드와 실행

현재 버전은 **0.10.1 (build 11)**이다. Rust 1.99.0, Python 3.11 이상, Xcode Command Line Tools, Homebrew의 Typst 0.15.1이 필요하다. `Cargo.lock`을 포함한다. 저장소 루트에서:

```sh
cargo +1.99.0 test --manifest-path native/Cargo.toml
cargo +1.99.0 clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
python3 scripts/native-notices.py
bash scripts/package-native.sh release
```

결과는 `native/target/Scholarly Native.app`이다. 외부 UI 프레임워크 의존성은 `gpui-kit = 0.9.1` 하나이며 플랫폼용 비-UI 기능은 별도 모듈에 둔다. `scripts/package-native.sh`는 Cargo manifest에서 버전과 빌드 번호를 읽고, 도우미와 앱을 로컬 실행용으로 서명한 뒤 서명을 검사한다. `SCHOLARLY_SIGN_IDENTITY`를 지정하면 기존 개발 인증서로 서명하며, 생략하면 임시 서명을 사용한다. 이 로컬 후보는 Developer ID 공증 배포본이 아니다.

개발 확인용 명령(결과 디렉터리는 원본과 분리):

```sh
"native/target/Scholarly Native.app/Contents/MacOS/Scholarly" --evaluate "/path/paper.pdf" "/path/evaluation"
"native/target/Scholarly Native.app/Contents/MacOS/Scholarly" --export-html "/path/paper.pdf" "/path/note.html"
```

`--evaluate`는 실제 선택된 공급자에 원문을 보내며 노트를 새로 작성한다. `SCHOLARLY_EVAL_MODEL`로 모델을 지정할 수 있다. `SCHOLARLY_EVAL_REVIEW=1`은 추가 원문 대조를 실행한다.

## 데이터와 복구

원본 데이터: `~/Library/Application Support/Scholarly/`. 네이티브 데이터: `~/Library/Application Support/Scholarly Native/`. 최초 실행에 SQLite 온라인 백업을 만들고 무결성을 검사한다. 두 앱의 DB는 분리되어 있으며 이후 변경을 자동 병합하지 않는다. 원본 PDF는 읽기만 한다.

노트는 PDF 옆 `summary/<이름>.learning.md`에 저장한다. 기존 `summary/<이름>.md`도 읽을 수 있으며 원문 대조를 거친 기존 문서의 저장 규칙을 바꾸지 않는다. `.previous`와 `.history/`에 이전 버전을 보관한다. `.figures.json`, `.assets/`는 원문 그림, `.review.json`은 원문 대조 기록이다. 개인 메모는 별도 DB 테이블에 저장한다. 이전 버전 복구도 현재 결과를 백업한 뒤 수행한다.

Codex·Claude 자격증명은 공식 CLI의 저장소를 그대로 사용한다. 기존 Electron의 암호화된 Ollama API 키를 임의 해독하지 않는다. 필요한 경우 설정에서 키를 입력하면 해당 서버 주소별 macOS Keychain 항목으로 저장한다. 다른 제공자나 API 과금 경로로 자동 전환하지 않는다.

## 검증 상태와 제한

- 이번 릴리즈에 포함되는 Electron 자동 테스트 64개, TypeScript 검사 및 프런트엔드/메인 프로세스 빌드 통과. 작업 전부터 있던 별도 모델 목록 변경 2개 검사는 이 커밋 범위에 포함하지 않았다.
- Rust 회귀 테스트 10개: 원자적 버전·메모 보존, 오래된 대조 결과 무효화, 그림 무결성/절 변경, 수식 HTML 및 원시 HTML 차단, 참고문헌 이후 부록 보존, 모든 쪽의 분할 보존, 한글 스트리밍·HTTP 취소, Codex 이벤트 순서·구독 한도 거부·큰 요청 중 취소, 실제 논문 수식 변환. 쉼표를 포함하는 키워드와 한글 강조 표기도 회귀 검사에 포함한다. Clippy 경고 없음.
- 기존 DB 다섯 테이블의 전체 행 해시와 개수 일치, SQLite 무결성 검사 통과.
- 실제 Codex 계정으로 Rust 경로의 논문 생성 성공. Claude와 원격 Ollama의 실제 계정 통합은 이 세션에서 실행하지 않았다. Ollama 전송은 로컬 테스트 서버로 검증했다.
- 수정본을 `/Volumes/Aquatope/Applications/Scholarly Native.app`에 기존 앱과 나란히 설치했다. 기존 `/Volumes/Aquatope/Applications/Scholarly.app`은 유지한다. 개발 인증서 서명·무결성 검사를 통과한 약 71MiB 후보이며, 기존 앱은 약 345MiB다.
- 설치본에서 원래 서재 964편 표시, 검색, 900px 창의 목록→상세 전환, 한글 붙여넣기를 확인했다. 필요한 아이콘만 추가로 포함해 실제 화면의 아이콘 누락을 해결했다. UI 시험용 root 설정은 원래 논문 폴더로 복원했다.
- HTML 예제의 47개 수식과 원문 그림 1개가 내장되었고, 브라우저에서 넓은 화면의 그림·해설 2열 및 좁은 화면의 세로 배치를 확인했다. 한글 조사 앞의 강조 기호가 그대로 노출되는 문제도 수정했다.
- 2026-11-14 사용자 승인 후 설치 앱에서 외장 볼륨의 실제 PDF·노트를 열었다. 한글 입력기로 전환 후 개별 키 입력으로 `한글` 조합, 메모 저장·재실행 후 복원, 본문 드래그 선택·복사·붙여넣기를 확인했다. 검증 메모는 정리했다.
- 기존 노트 재작성을 시작하고 새 본문 스트리밍 중 취소했다. 기존 본문·그림 manifest·이미지 SHA-256이 모두 유지됐다. 원문 3쪽에서 그림 드래그→연결→해제도 UI로 검증했으며 기존 그림은 보존됐다.
- 네이티브 그림의 과도한 세로 공백을 수정했다. PNG 비율을 미리 읽어 표시 폭에 맞는 영역을 잡고, 같은 절 안에서 해당 그림 번호를 인용하는 문단과 연결한다. 근거 없는 첫 문단 자동 연결은 하지 않으며, 대응 문단이 없으면 캡션만 표시한다. 넓은 영역의 나란한 배치와 좁은 영역의 세로 배치를 확인했다.
- 블록 수식의 줄바꿈이 캐시 조회와 달라 원문 표기로 남는 문제를 수정했다. 설치본에서 분수·아래첨자·합계 및 인라인 수식을 확인했다. 창 축소·확대 시 서로 다른 패널 구성의 폭이 섞이지 않도록 상태도 분리했다. 이 변경은 노트 본문을 재생성하거나 AI를 추가 호출하지 않는다.
- `Window created` 로그는 첫 화면 표시나 첫 상호작용 시간이 아니다. 1초 기동·100ms 전환 목표는 아직 실측으로 입증하지 않았다. 초기 debug 프로세스 메모리 단일 관측은 정식 성능 비교에 쓰지 않는다.
- 문서를 인식하지 못하는 스캔 PDF는 OCR 사본이 필요하다. 전체 본문을 잘라 성공한 것으로 처리하지 않는다. 자동 그림 판독, 자동 크롭, 여러 앱 간 변경 병합은 포함하지 않는다.

구체적인 논문별 시간·품질과 빠른 모델을 기본으로 채택하지 않은 이유는 [평가 기록](../docs/evaluation/2026-11-13-learning-native.md)에 있다.
