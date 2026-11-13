import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectChatStream } from './streaming';
import { assertIncludedUsage } from './codex-server';
import { generationFingerprint, generateLearningNote, learningStatus, parseLearningNote, publishLearningNote, orderedPool } from './learning';
import type { GuidanceGenerationInput } from './ai';

const input: GuidanceGenerationInput = {
  document: { pageCount: 1, pages: [{ pageNumber: 1, text: 'Methods and Results. Twenty participants were randomized, ten per group. The primary outcome was not statistically significant. This result does not establish equivalence.' }], referencesOmitted: false, diagnostics: [] },
  sourceUnit: { unitType: 'article', sourceRelpath: 'paper.pdf', sourceSha256: 'a'.repeat(64), sourceSizeBytes: 1000, sourcePageCount: 1, sourcePageStart: 1, sourcePageEnd: 1, title: 'Trial', authors: [], year: null, journal: null, doi: null, metadataSource: 'filename', outputLanguage: 'en', paperType: 'EMPIRICAL', keywords: [], generatorAppVersion: 'test', generatorModel: 'test', promptVersion: 'learning-v1', extractionVersion: 'test' }
};
const body = ['0. Snapshot','1. Prerequisite Knowledge','2. Purpose & Scope','3. Section-by-Section Digest','4. Key Findings & Details','5. Integrated Summary','6. Coverage Map'].map(h => `# ${h}\n\nTwenty participants were randomized, ten per group. The primary outcome was not statistically significant; the evidence does not establish equivalence. [Source: p. 1]`).join('\n\n');
const completed = { content: body, finishReason: 'stop', usage: null, requestAttempts: 1 };

test('learning uses one completion and publishes explicit unreviewed status; replacement preserves previous bytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-test-'));
  try {
    const target = path.join(dir, 'note.learning.md'); let calls = 0;
    const result = await generateLearningNote(input, 'test', async () => { calls++; return completed; }, {});
    assert.equal(calls, 1);
    const fingerprint = generationFingerprint(input.sourceUnit, '', 'low');
    publishLearningNote(target, input.sourceUnit, input.document, result, fingerprint);
    const original = fs.readFileSync(target, 'utf8');
    assert.equal(learningStatus(original, fingerprint), 'current');
    assert.equal(parseLearningNote(original).metadata.factual_review_status, 'not_run');
    assert.equal(parseLearningNote(original).metadata.review_status, undefined);
    assert.equal(learningStatus(original, 'different'), 'stale');
    assert.equal(learningStatus(original.replace('Twenty', 'Thirty'), fingerprint), 'failed');
    publishLearningNote(target, input.sourceUnit, input.document, result, fingerprint);
    assert.equal(fs.readFileSync(`${target}.previous`, 'utf8'), original);
    const replacement = fs.readFileSync(target, 'utf8');
    assert.throws(() => publishLearningNote(target, input.sourceUnit, input.document, { ...result, finishReason: 'length' }, fingerprint));
    assert.equal(fs.readFileSync(target, 'utf8'), replacement);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('cancelled and abstract-only runs do not yield a publishable learning note', async () => {
  const controller = new AbortController();
  await assert.rejects(generateLearningNote(input, 'test', async () => { controller.abort(); return completed; }, { signal: controller.signal }), /cancelled/);
  await assert.rejects(generateLearningNote({ ...input, document: { ...input.document, pages: [{ pageNumber: 1, text: 'Abstract\n' + 'Only a brief abstract. '.repeat(10) }] } }, 'test', async () => { throw Error('must not call'); }, {}), /abstract/);
});
test('bounded parallel work retains source order and drains in-flight work before failure', async () => {
  let active = 0; let peak = 0; let finished = 0;
  await assert.rejects(orderedPool([1,2,3,4], 2, async x => {
    active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, x === 1 ? 5 : 20)); active--; finished++;
    if (x === 1) throw Error('failure'); return x;
  }), /failure/);
  assert.equal(active, 0); assert.equal(peak, 2); assert.equal(finished, 2);
  assert.deepEqual(await orderedPool([1,2,3], 2, async x => x*2), [2,4,6]);
});
function streamed(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (const b of bytes) controller.enqueue(Uint8Array.of(b)); controller.close(); } }));
}
test('SSE reconstructs split Unicode and CRLF frames, hides reasoning, and requires final status', async () => {
  let final = '';
  const value = await collectChatStream(streamed('data: {"choices":[{"index":0,"delta":{"reasoning_content":"secret","content":"한글"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" 설명"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n'), text => final = text) as any;
  assert.equal(final, '한글 설명'); assert.equal(value.choices[0].finish_reason, 'stop');
  await assert.rejects(collectChatStream(streamed('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), () => {}), /without a completion/);
});
test('Codex included-usage gate rejects unknown, exhausted and invalid usage without fallbacks', () => {
  assert.throws(() => assertIncludedUsage({ordinaryUsageAllowed:null}, 'model'));
  assert.throws(() => assertIncludedUsage({ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:100}}}, 'model'));
  assert.throws(() => assertIncludedUsage({ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:-1}}}, 'model'));
  assert.doesNotThrow(() => assertIncludedUsage({ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:5}}}, 'model'));
});
