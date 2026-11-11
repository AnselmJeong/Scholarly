import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveRestorableRootPath } from './root-folder';

test('last root restoration accepts an existing readable directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scholarly-root-test-'));
  assert.equal(resolveRestorableRootPath(directory), path.resolve(directory));
});

test('last root restoration rejects missing paths and regular files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scholarly-root-test-'));
  const file = path.join(directory, 'paper.pdf');
  fs.writeFileSync(file, 'not a directory');

  assert.equal(resolveRestorableRootPath(path.join(directory, 'missing')), null);
  assert.equal(resolveRestorableRootPath(file), null);
  assert.equal(resolveRestorableRootPath(null), null);
});
