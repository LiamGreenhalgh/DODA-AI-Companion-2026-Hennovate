import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  normalizeEvent,
  normalizeTitle,
  type RawEventCandidate,
} from '@delaware-scene/domain';

interface TitleCase {
  raw: string;
  expectedValid: boolean;
}

const whitespaceArbitrary = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0', '\u2003'), {
    minLength: 1,
    maxLength: 6,
  })
  .map((characters) => characters.join(''));

const optionalWhitespaceArbitrary = fc.oneof(fc.constant(''), whitespaceArbitrary);
const titleTokenArbitrary = fc
  .array(fc.constantFrom('A', 'r', 't', '9', 'é', '中', '🎨'), {
    minLength: 1,
    maxLength: 20,
  })
  .map((characters) => characters.join(''));

const validTitleArbitrary: fc.Arbitrary<TitleCase> = fc
  .record({
    leading: optionalWhitespaceArbitrary,
    tokens: fc.array(titleTokenArbitrary, { minLength: 1, maxLength: 12 }),
    separator: whitespaceArbitrary,
    trailing: optionalWhitespaceArbitrary,
  })
  .map(({ leading, tokens, separator, trailing }) => ({
    raw: `${leading}${tokens.join(separator)}${trailing}`,
    expectedValid: true,
  }));

const invalidTitleArbitrary: fc.Arbitrary<TitleCase> = fc.oneof(
  whitespaceArbitrary.map((raw) => ({ raw, expectedValid: false })),
  fc
    .record({
      character: fc.constantFrom('a', 'é', '中', '🎨'),
      length: fc.integer({ min: 301, max: 340 }),
      leading: optionalWhitespaceArbitrary,
      trailing: optionalWhitespaceArbitrary,
    })
    .map(({ character, length, leading, trailing }) => ({
      raw: `${leading}${character.repeat(length)}${trailing}`,
      expectedValid: false,
    })),
);

const titleCaseArbitrary = fc.oneof(validTitleArbitrary, invalidTitleArbitrary);

function candidate(title: string): RawEventCandidate {
  return {
    id: 'event-generated',
    sourceRecordId: 'source-generated',
    sourceCategory: 'government',
    sourceUrl: 'https://events.example.org/generated',
    retrievedAt: '2026-08-18T12:00:00Z',
    title,
    occurrences: [{ id: 'occurrence-generated', start: '2027-05-01' }],
  };
}

describe('event text normalization properties', () => {
  it('is idempotent, enforces normalized title bounds, and preserves omitted values as unknown', () => {
    // Feature: delaware-scene-full-stack-clone, Property 10: Event text normalization is idempotent and non-fabricating
    // **Validates: Requirements 4.1, 4.2, 4.3, 4.10**
    fc.assert(
      fc.property(titleCaseArbitrary, ({ raw, expectedValid }) => {
        const referenceTitle = raw.trim().replace(/\s+/gu, ' ');
        const titleResult = normalizeTitle(raw);
        const eventResult = normalizeEvent(candidate(raw));
        const referenceIsValid =
          [...referenceTitle].length >= 1 && [...referenceTitle].length <= 300;

        expect(referenceIsValid).toBe(expectedValid);
        if (!expectedValid) {
          if (titleResult.ok || eventResult.ok) {
            throw new Error('Out-of-bounds normalized titles must not produce a value to write.');
          }
          expect(titleResult.errors).toEqual([
            expect.objectContaining({ path: 'title', code: 'invalid_length' }),
          ]);
          expect(eventResult.errors).toEqual(titleResult.errors);
          return;
        }

        if (!titleResult.ok || !eventResult.ok) {
          throw new Error('A title within the normalized bounds must be accepted.');
        }
        expect(titleResult.value).toBe(referenceTitle);
        expect(normalizeTitle(titleResult.value)).toEqual(titleResult);
        expect(eventResult.value).toMatchObject({
          title: referenceTitle,
          description: null,
          categories: [],
          organization: null,
          venue: null,
          city: null,
          region: null,
          cost: null,
          audience: null,
          accessibility: null,
          address: null,
          coordinates: null,
          onlineLocationUrl: null,
          publicSourceUrl: null,
          ticketUrl: null,
          registrationUrl: null,
          attribution: null,
          rightsNotice: null,
          publicationStatus: 'pending',
          validationIssues: [],
          provenance: [expect.objectContaining({ sourceSuppliedId: null })],
        });
      }),
      { numRuns: 100 },
    );
  });
});
