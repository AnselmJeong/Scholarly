#!/bin/bash
# Run from Finder/Terminal on the Mac where Scholarly is installed.
# Build and check the new app before touching the currently installed version.
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"

staged_app=""
backup_app=""
installed_app="/Applications/Scholarly.app"
finish() {
  result=$?
  if [ "$result" -ne 0 ]; then
    if [ -n "$backup_app" ] && [ -d "$backup_app" ] && [ ! -e "$installed_app" ]; then
      mv "$backup_app" "$installed_app" || true
    fi
    printf '\n설치가 완료되지 않았습니다. 위 오류를 확인하세요.\n'
  fi
  if [ -n "$staged_app" ] && [ -d "$staged_app" ]; then rm -rf "$staged_app"; fi
  if [ -t 0 ]; then read -r -p 'Enter를 누르면 닫힙니다. ' _reply || true; fi
  exit "$result"
}
trap finish EXIT

command -v node >/dev/null
command -v npm >/dev/null
printf 'Scholarly 의존성 설치 및 검증…\n'
npm ci --no-audit --no-fund
npm test
npm run lint
# Local installation does not require a Developer ID or notarization.
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build

version="$(node -p "require('./package.json').version")"
case "$(uname -m)" in
  arm64) built_app="$repo_dir/release/$version/mac-arm64/Scholarly.app" ;;
  x86_64) built_app="$repo_dir/release/$version/mac/Scholarly.app" ;;
  *) printf '지원하지 않는 Mac 아키텍처입니다.\n'; exit 1 ;;
esac
[ -d "$built_app" ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$built_app/Contents/Info.plist")" = "$version" ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$built_app/Contents/Info.plist")" = 'com.scholarly.app' ]
[ -x "$built_app/Contents/MacOS/Scholarly" ]
[ -s "$built_app/Contents/Resources/app.asar" ]

if [ ! -w /Applications ]; then
  printf '/Applications에 쓸 수 없습니다. 설치 권한이 있는 계정에서 실행하세요.\n'
  exit 1
fi
staged_app="/Applications/.Scholarly-install-$$.app"
[ ! -e "$staged_app" ]
ditto "$built_app" "$staged_app"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$staged_app/Contents/Info.plist")" = "$version" ]

if pgrep -f '^/Applications/Scholarly.app/Contents/MacOS/' >/dev/null; then
  osascript -e 'tell application "Scholarly" to quit'
  for _attempt in 1 2 3 4 5 6 7 8 9 10; do
    if ! pgrep -f '^/Applications/Scholarly.app/Contents/MacOS/' >/dev/null; then break; fi
    sleep 1
  done
  if pgrep -f '^/Applications/Scholarly.app/Contents/MacOS/' >/dev/null; then
    printf 'Scholarly를 종료한 후 다시 실행하세요. 기존 앱은 변경하지 않았습니다.\n'
    exit 1
  fi
fi

if [ -e "$installed_app" ]; then
  backup_app="/Applications/Scholarly-backup-$(date +%Y%m%d-%H%M%S)-$$.app"
  mv "$installed_app" "$backup_app"
fi
mv "$staged_app" "$installed_app"
staged_app=""
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$installed_app/Contents/Info.plist")" = "$version" ]
open "$installed_app"
printf '\nScholarly %s 설치 완료. 기존 논문·설정·데이터는 보존했습니다.\n' "$version"
if [ -n "$backup_app" ]; then printf '이전 앱 백업: %s\n' "$backup_app"; fi
