#!/usr/bin/env python3
"""Collect redistribution notices from the locked Cargo dependency sources."""
from pathlib import Path
import json, subprocess
root=Path(__file__).resolve().parents[1]
metadata=json.loads(subprocess.check_output(['cargo','+1.99.0','metadata','--locked','--manifest-path',str(root/'native/Cargo.toml'),'--format-version','1']))
output=['Scholarly Native — third-party software notices\n\nDependency versions are pinned by native/Cargo.lock.\n']
for package in sorted(metadata['packages'],key=lambda p:(p['name'],p['version'])):
    if package['name']=='scholarly-native':continue
    output.append(f"\n{'='*72}\n{package['name']} {package['version']} — {package.get('license') or 'See source license'}\n{package.get('repository') or ''}\n")
    directory=Path(package['manifest_path']).parent
    for file in sorted(directory.iterdir()):
        if file.is_file() and file.name.lower().startswith(('license','licence','copying','notice')):
            try:output.append(f'\n{file.name}\n{file.read_text()}\n')
            except UnicodeError:pass
for file in [Path('/opt/homebrew/opt/typst/LICENSE'),Path('/opt/homebrew/opt/typst/NOTICE')]:
    output.append(f'\nTypst 0.15.1 — {file.name}\n{file.read_text()}\n')
(root/'native/THIRD_PARTY_NOTICES.txt').write_text(''.join(output))
print('Wrote native/THIRD_PARTY_NOTICES.txt')
