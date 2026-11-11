import assert from 'node:assert/strict';
import test from 'node:test';
import { omitReferenceSection } from './pdf';

function referenceList(): string {
  return [
    'Smith J (2019) First longitudinal investigation of the clinical phenomenon. https://doi.org/10.1/one',
    'Jones K (2020) Second controlled investigation with extended follow-up observations.',
    'Lee M (2021) Third systematic account of the relevant neurobiological mechanisms.',
    'Brown A (2022) Fourth paper on patient expectations and treatment outcomes. https://doi.org/10.1/four',
    'Garcia P (2018) Experimental evidence from a randomized clinical population.',
    'Miller T (2017) Methodological considerations for interpreting placebo responses.'
  ].join('\n');
}

function numberedReferenceList(): string {
  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    return `${number}. Author ${number} (${2010 + index}) Numbered reference entry with journal and page details. https://doi.org/10.1/${number}`;
  }).join('\n');
}

test('digest extraction omits a genuine trailing reference list and preserves physical page numbers', () => {
  const body = 'Introduction\n' + 'Substantive discussion with an in-text citation (Author 2020). '.repeat(30);
  const pages = [
    { pageNumber: 1, text: body },
    {
      pageNumber: 2,
      text: `Conclusion\nThe central argument ends here.\nReferences\n${referenceList()}`
    },
    { pageNumber: 3, text: 'Wilson R (2016) Additional reference continued on the final physical page.' }
  ];

  const result = omitReferenceSection(pages);

  assert.equal(result.referencesOmitted, true);
  assert.deepEqual(result.pages.map(page => page.pageNumber), [1, 2]);
  assert.match(result.pages[0].text, /\(Author 2020\)/);
  assert.match(result.pages[1].text, /central argument ends here/);
  assert.doesNotMatch(result.pages.map(page => page.text).join('\n'), /Smith J|Brown A/);
  assert.match(result.diagnostic ?? '', /physical PDF pages 2-3/);
});

test('reference filtering ignores an early table-of-contents entry', () => {
  const pages = [
    { pageNumber: 1, text: 'Contents\nIntroduction\nMethods\nReferences\n' },
    { pageNumber: 2, text: 'Introduction\n' + 'Substantive article text. '.repeat(40) },
    { pageNumber: 3, text: 'Discussion\nThe paper concludes without a reference section.' }
  ];

  const result = omitReferenceSection(pages);

  assert.equal(result.referencesOmitted, false);
  assert.deepEqual(result.pages, pages);
});

test('reference filtering preserves an appendix that follows the reference list', () => {
  const pages = [
    { pageNumber: 1, text: 'Main text\n' + 'Substantive article text. '.repeat(40) },
    {
      pageNumber: 2,
      text: `References\n${referenceList()}`
    },
    { pageNumber: 3, text: 'Appendix\nFull questionnaire and scoring instructions.' }
  ];

  const result = omitReferenceSection(pages);

  assert.equal(result.referencesOmitted, true);
  assert.deepEqual(result.pages.map(page => page.pageNumber), [1, 3]);
  assert.match(result.pages[1].text, /^Appendix/);
  assert.doesNotMatch(result.pages.map(page => page.text).join('\n'), /Smith J/);
});

test('reference filtering detects a long numbered reference list without a heading', () => {
  const pages = [
    { pageNumber: 1, text: 'Main text\n' + 'Substantive review discussion. '.repeat(50) },
    {
      pageNumber: 2,
      text: `Conclusion\nThe review ends with its substantive conclusion.\n${numberedReferenceList()}`
    }
  ];

  const result = omitReferenceSection(pages);

  assert.equal(result.referencesOmitted, true);
  assert.match(result.pages.at(-1)?.text ?? '', /substantive conclusion/);
  assert.doesNotMatch(result.pages.map(page => page.text).join('\n'), /1\. Author 1/);
  assert.match(result.diagnostic ?? '', /Numbered references/);
});
