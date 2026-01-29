Plan: 사용자 정의 Markdown 테마 지원
목표
사용자가 ~/Library/Application Support/Scholarly/themes/ 폴더에 Typora 호환 CSS 테마를 추가하여 사용할 수 있도록 확장

현재 상태 (완료됨)
4개의 빌트인 테마: lapis-dark, lapis, vercel, newsprint
정적 CSS import 방식 사용
Settings에서 테마 선택 가능
구현 계획
1단계: 테마 서비스 생성
파일: electron/services/themes.ts (신규)


interface ThemeInfo {
  id: string;           // 'lapis-dark' 또는 'custom-mytheme'
  name: string;         // 표시 이름
  isBuiltIn: boolean;   // 빌트인 여부
  filePath?: string;    // 커스텀 테마의 경우 파일 경로
}

// 기능:
// - getThemesDirectory(): 테마 디렉토리 경로 반환
// - ensureThemesDirectory(): 디렉토리 없으면 생성
// - scanCustomThemes(): 커스텀 테마 목록 스캔
// - getAvailableThemes(): 빌트인 + 커스텀 테마 목록
// - loadCustomThemeCSS(themeId): CSS 파일 내용 읽기
2단계: IPC 핸들러 추가
파일: electron/main.ts


// 신규 핸들러:
ipcMain.handle('get-available-themes', async () => ThemeInfo[])
ipcMain.handle('get-custom-theme-css', async (_, themeId) => string)
ipcMain.handle('open-themes-folder', async () => void)  // Finder에서 열기
3단계: 타입 수정
파일: electron/store.ts


// 변경: 유니온 타입 → string (커스텀 테마 허용)
export type MarkdownTheme = string;

// 빌트인 테마 목록은 별도 상수로 유지
export const BUILTIN_THEMES = ['lapis-dark', 'lapis', 'vercel', 'newsprint'] as const;
4단계: SettingsModal 업데이트
파일: src/components/SettingsModal.tsx

get-available-themes IPC로 테마 목록 동적 로드
드롭다운에 빌트인/커스텀 테마 구분 표시
"Open Themes Folder" 버튼 추가
5단계: GuidanceViewer 동적 CSS 주입
파일: src/components/GuidanceViewer.tsx


// 빌트인 테마: 기존 정적 import 유지
// 커스텀 테마: <style> 태그로 동적 주입

useEffect(() => {
  if (!BUILTIN_THEMES.includes(theme)) {
    // 커스텀 테마 CSS 로드 및 주입
    window.ipcRenderer.invoke('get-custom-theme-css', theme)
      .then(css => injectCustomCSS(css));
  }
}, [theme]);
6단계: App.tsx 업데이트
파일: src/App.tsx

MarkdownTheme 타입을 string으로 변경
커스텀 테마 로드 실패 시 기본 테마로 폴백
CSS 자동 변환 (Typora 호환)
테마 로드 시 자동 변환 수행:


function transformTyporaCSS(css: string, themeName: string): string {
  const wrapper = `.theme-${themeName}`;

  return css
    // #write → .theme-{name}
    .replace(/#write\b/g, wrapper)
    // :root { --var } → .theme-{name} { --var }
    .replace(/:root\s*\{/g, `${wrapper} {`)
    // html, body 셀렉터 제거 (배경색 등은 별도 처리)
    .replace(/^(html|body)\s*\{[^}]*\}/gm, '')
    // .cm-s-inner 등 CodeMirror 셀렉터 → .theme-{name} pre
    .replace(/\.cm-s-inner/g, `${wrapper} pre`);
}
커스텀 테마 파일 규칙
사용자는 Typora 테마 CSS를 그대로 사용 가능:

파일명: {theme-name}.css (예: dracula.css)
위치: ~/Library/Application Support/Scholarly/themes/
자동 변환: #write, :root 셀렉터가 자동으로 .theme-{name}으로 변환됨
Typora 원본 CSS 예시 (그대로 사용 가능):


/* dracula.css - Typora 원본 */
:root {
  --text-color: #f8f8f2;
  --bg-color: #282a36;
}
#write {
  color: var(--text-color);
  background: var(--bg-color);
}
#write h1 { color: #ff79c6; }
변환 후 결과 (자동):


.theme-dracula {
  --text-color: #f8f8f2;
  --bg-color: #282a36;
}
.theme-dracula {
  color: var(--text-color);
  background: var(--bg-color);
}
.theme-dracula h1 { color: #ff79c6; }
수정/생성 파일 목록
electron/services/themes.ts - 신규 (테마 스캔/로드 서비스)
electron/main.ts - IPC 핸들러 추가
electron/store.ts - 타입 수정
src/components/SettingsModal.tsx - 동적 테마 목록, 폴더 열기 버튼
src/components/GuidanceViewer.tsx - 동적 CSS 주입
src/App.tsx - 타입 및 폴백 처리
검증 방법
앱 시작 → ~/Library/Application Support/Scholarly/themes/ 폴더 자동 생성 확인
Settings → "Open Themes Folder" 클릭 → Finder에서 열리는지 확인
테스트 CSS 파일 (test-theme.css) 추가:

.theme-test-theme {
  --text: red;
}
.theme-test-theme p { color: var(--text); }
Settings 다시 열기 → 드롭다운에 "test-theme" 표시 확인
선택 → GuidanceViewer에서 빨간색 텍스트 확인
앱 재시작 → 커스텀 테마 설정 유지 확인
잘못된 CSS 파일 → 기본 테마로 폴백 확인
