#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROFILE=${1:-release}
if [ "$PROFILE" = release ]; then
  cargo +1.99.0 build --manifest-path "$ROOT/native/Cargo.toml" --locked --release
else
  cargo +1.99.0 build --manifest-path "$ROOT/native/Cargo.toml" --locked
fi
swiftc -O "$ROOT/native/platform/pdf-helper.swift" -o "$ROOT/native/target/pdf-helper"
BUNDLE=${SCHOLARLY_BUNDLE_PATH:-"$ROOT/native/target/Scholarly Native.app"}
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$ROOT/native/target/$PROFILE/scholarly-native" "$BUNDLE/Contents/MacOS/Scholarly"
cp "$ROOT/native/target/pdf-helper" "$BUNDLE/Contents/Resources/pdf-helper"
cp -f /opt/homebrew/bin/typst "$BUNDLE/Contents/Resources/typst"
cp "$ROOT/native/THIRD_PARTY_NOTICES.txt" "$BUNDLE/Contents/Resources/Third Party Notices.txt"
if [ -f "$ROOT/native/assets/Scholarly.icns" ]; then
  cp "$ROOT/native/assets/Scholarly.icns" "$BUNDLE/Contents/Resources/Scholarly.icns"
fi
python3 - "$ROOT/native/Cargo.toml" "$BUNDLE/Contents/Info.plist" <<'PYMETA'
import plistlib, sys, tomllib
from pathlib import Path
package = tomllib.loads(Path(sys.argv[1]).read_text())["package"]
info = {
    "CFBundleIdentifier": "com.scholarly.native",
    "CFBundleName": "Scholarly Native",
    "CFBundleDisplayName": "Scholarly Native",
    "CFBundleExecutable": "Scholarly",
    "CFBundleIconFile": "Scholarly.icns",
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": package["version"],
    "CFBundleVersion": str(package["metadata"]["bundle"]["build-number"]),
    "LSMinimumSystemVersion": "13.0",
    "NSHighResolutionCapable": True,
    "NSRemovableVolumesUsageDescription": "선택한 논문 폴더에서 PDF를 읽고 학습 노트와 원문 그림을 저장합니다.",
}
with open(sys.argv[2], "wb") as output:
    plistlib.dump(info, output)
PYMETA

codesign --force --sign "${SCHOLARLY_SIGN_IDENTITY:--}" "$BUNDLE/Contents/Resources/pdf-helper"
codesign --force --sign "${SCHOLARLY_SIGN_IDENTITY:--}" "$BUNDLE/Contents/Resources/typst"
codesign --force --sign "${SCHOLARLY_SIGN_IDENTITY:--}" "$BUNDLE"
codesign --verify --deep --strict "$BUNDLE"
printf '%s\n' "$BUNDLE"
