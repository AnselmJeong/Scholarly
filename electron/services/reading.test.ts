import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReadingPlan, parseQualityReview, runDeepReading, assertCompleteResponse } from './reading';
import type { ReadingPlan } from './reading';
import type { GuidanceGenerationInput, ChatCompletionResult, ChatMessage } from './ai';
import { sha256 } from './digest';

const pages = [{ pageNumber: 1, text: 'Introduction Methods Results Discussion. A randomized trial included 20 participants, ten in each group. The primary outcome was not statistically significant. No adverse events were reported.' }];
const plan: ReadingPlan = {
  readingType: 'human_subjects_empirical', fullTextAvailable: true,
  rationale: 'Randomized trial of people.', storyline: 'The study tests a treatment. It randomizes participants. The result is null.',
  sections: [{ title: 'Methods and Results', pages: [1] }],
  centralClaims: [{ claim: 'Null primary outcome', evidence: 'No statistically significant difference.', pages: [1], boundary: 'Does not establish equivalence.' }],
  coreAnswers: [{ question: 'Sample?', answer: '20 participants', pages: [1], notReported: false }]
};
const input: GuidanceGenerationInput = {
  document: { pageCount: 1, pages, referencesOmitted: false, diagnostics: [] },
  sourceUnit: {
    unitType: 'article', sourceRelpath: 'paper.pdf', sourceSha256: 'a'.repeat(64), sourceSizeBytes: 1000,
    sourcePageCount: 1, sourcePageStart: 1, sourcePageEnd: 1, title: 'Trial', authors: ['Author'],
    year: 2026, journal: null, doi: null, metadataSource: 'manual', outputLanguage: 'en', paperType: 'EMPIRICAL',
    keywords: [], generatorAppVersion: '0.8.0', generatorModel: 'test', promptVersion: 'test', extractionVersion: 'test'
  }
};
const body = `# 0. Snapshot
The randomized study tests a treatment in twenty participants and reports a null result. [Source: p. 1]
# 1. Prerequisite Knowledge
A null result means the test did not establish a statistically significant difference, rather than demonstrating equivalence.
# 2. Purpose & Scope
The paper evaluates the primary treatment outcome in a randomized trial. [Source: p. 1]
# 3. Section-by-Section Digest
**Methods and Results —**
**Main content:** Twenty participants were randomized. [Source: p. 1]
**Key evidence:** The primary outcome was not statistically significant. [Source: p. 1]
**Connection:** These results inform the conclusion.
# 4. Key Findings & Details
No adverse events were reported. [Source: p. 1]
# 5. Integrated Summary
The study does not establish a treatment difference or equivalence. [Source: p. 1]
# 6. Coverage Map
Methods and results, physical page 1. Figures were not visually inspected.`;
const result = (content: string): ChatCompletionResult => ({ content, finishReason: 'stop', usage: null, requestAttempts: 1 });

test('plan rejects invented/unreadable page locators and missing claim boundaries', () => {
  assert.equal(parseReadingPlan(JSON.stringify(plan), pages).readingType, 'human_subjects_empirical');
  assert.throws(() => parseReadingPlan(JSON.stringify({ ...plan, sections: [{ title: 'Results', pages: [99] }] }), pages));
  assert.throws(() => parseReadingPlan(JSON.stringify(plan), [{ pageNumber: 1, text: '' }]));
  assert.throws(() => parseReadingPlan(JSON.stringify({ ...plan, centralClaims: [{ ...plan.centralClaims[0], boundary: '' }] }), pages));
});

test('review fails closed for malformed or contradictory verdicts and truncation', () => {
  assert.throws(() => parseQualityReview('{"passed":true,"findings":["wrong number"]}'));
  assert.throws(() => parseQualityReview('{"passed":false,"findings":[]}'));
  assert.throws(() => parseQualityReview('looks good'));
  assert.throws(() => assertCompleteResponse({ ...result('half a note'), finishReason: 'length' }));
});

test('abstract-only input is blocked before drafting', async () => {
  let calls = 0;
  await assert.rejects(runDeepReading(input, 'source', [], async () => {
    calls++;
    return result(JSON.stringify({ ...plan, fullTextAvailable: false, rationale: 'Only an abstract is available.' }));
  }, {}), /Full-text reading blocked/);
  assert.equal(calls, 1);
});

test('fresh review repairs a draft and binds the passing audit to final bytes', async () => {
  const requests: ChatMessage[][] = [];
  const revised = body.replace('Twenty participants were randomized.', 'Twenty participants were randomized, ten in each group.');
  const responses = [JSON.stringify(plan), body, '{"passed":false,"findings":["Include ten participants per group."]}', revised, '{"passed":true,"findings":[]}'];
  const completed = await runDeepReading(input, 'source', [], async messages => {
    requests.push(messages);
    return result(responses.shift()!);
  }, {});
  assert.equal(completed.content, revised);
  assert.equal(completed.readingAudit.finalBodySha256, sha256(revised));
  assert.equal(completed.readingAudit.reviews.length, 2);
  assert.equal(requests[2].length, 2);
  assert.match(requests[3][1].content, /ten participants per group/);
  assert.equal(completed.readingAudit.reviews[1].passed, true);
});

test('long-paper reviews verify raw chunks as well as the evidence plan', async () => {
  const requests: ChatMessage[][] = [];
  const responses = [JSON.stringify(plan), body, '{"passed":true,"findings":[]}', '{"passed":true,"findings":[]}'];
  const completed = await runDeepReading(input, 'evidence map', [pages], async messages => {
    requests.push(messages);
    return result(responses.shift()!);
  }, {});
  assert.equal(completed.readingAudit.reviewBasis, 'evidence_and_source_chunks');
  assert.match(requests[3][1].content, /randomized trial included 20/);
});

test('quality failures exhaust exactly two revisions and never produce publishable content', async () => {
  let drafts = 0;
  let calls = 0;
  await assert.rejects(runDeepReading(input, 'source', [], async messages => {
    if (++calls === 1) return result(JSON.stringify(plan));
    if (messages[0].content.includes('fresh quality reviewer')) return result('{"passed":false,"findings":["Unsupported causal claim."]}');
    drafts++;
    return result(body);
  }, {}), /after two revisions/);
  assert.equal(drafts, 3);
});

test('cancellation stops the pipeline between requests', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(runDeepReading(input, 'source', [], async () => {
    calls++;
    controller.abort();
    return result(JSON.stringify(plan));
  }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
