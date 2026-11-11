import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldGenerateGuidanceForOpen } from '../../src/lib/guidance-open';

test('opening an existing stale or failed digest never starts generation', () => {
  assert.equal(shouldGenerateGuidanceForOpen({ success: true, status: 'current', content: 'current' }), false);
  assert.equal(shouldGenerateGuidanceForOpen({ success: true, status: 'stale', content: 'previous' }), false);
  assert.equal(shouldGenerateGuidanceForOpen({ success: true, status: 'failed', content: 'previous' }), false);
});

test('opening a source without a digest starts generation', () => {
  assert.equal(shouldGenerateGuidanceForOpen({ success: false, status: 'missing' }), true);
  assert.equal(shouldGenerateGuidanceForOpen({ success: false, status: 'failed', error: 'last attempt failed' }), true);
});
