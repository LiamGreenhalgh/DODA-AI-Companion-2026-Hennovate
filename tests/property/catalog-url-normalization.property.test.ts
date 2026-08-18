import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { UrlField } from '@delaware-scene/domain';
import { normalizeUrlField } from '@delaware-scene/ingestion';
import { safeDomainArbitrary } from '@delaware-scene/test-support';

interface GeneratedUrlEntry {
  raw: string;
  normalized: string;
  inputScheme: 'bare' | 'http' | 'https';
}

interface GeneratedPiece {
  raw: string;
  entry: GeneratedUrlEntry | null;
}

interface UrlFieldCase {
  raw: string;
  expected: UrlField;
  entries: readonly GeneratedUrlEntry[];
}

const whitespaceArbitrary = fc.constantFrom('', ' ', '  ', '\t', ' \t ');
const pathArbitrary = fc
  .array(fc.stringMatching(/^[a-z0-9]{1,8}$/u), { minLength: 0, maxLength: 3 })
  .map((segments) => (segments.length === 0 ? '' : `/${segments.join('/')}`));

const urlEntryArbitrary: fc.Arbitrary<GeneratedUrlEntry> = fc
  .tuple(fc.constantFrom<'bare' | 'http' | 'https'>('bare', 'http', 'https'), safeDomainArbitrary, pathArbitrary)
  .map(([inputScheme, domain, path]) => {
    const raw = inputScheme === 'bare' ? `${domain}${path}` : `${inputScheme}://${domain}${path}`;
    return {
      raw,
      normalized: new URL(inputScheme === 'bare' ? `https://${raw}` : raw).href,
      inputScheme,
    };
  });

const retainedPieceArbitrary: fc.Arbitrary<GeneratedPiece> = fc
  .tuple(whitespaceArbitrary, urlEntryArbitrary, whitespaceArbitrary)
  .map(([before, entry, after]) => ({ raw: `${before}${entry.raw}${after}`, entry }));

const emptyPieceArbitrary: fc.Arbitrary<GeneratedPiece> = whitespaceArbitrary.map((raw) => ({
  raw,
  entry: null,
}));

const valuesCaseArbitrary: fc.Arbitrary<UrlFieldCase> = fc
  .tuple(
    fc.array(emptyPieceArbitrary, { maxLength: 3 }),
    retainedPieceArbitrary,
    fc.array(fc.oneof(retainedPieceArbitrary, emptyPieceArbitrary), { maxLength: 9 }),
  )
  .map(([prefix, first, suffix]) => {
    const pieces = [...prefix, first, ...suffix];
    const entries = pieces.flatMap((piece) => (piece.entry ? [piece.entry] : []));
    return {
      raw: pieces.map((piece) => piece.raw).join(';'),
      expected: { kind: 'values', values: entries.map((entry) => entry.normalized) },
      entries,
    };
  });

const urlFieldCaseArbitrary: fc.Arbitrary<UrlFieldCase> = fc.oneof(
  fc.constant({
    raw: 'NKS',
    expected: { kind: 'known-absence' } as const,
    entries: [],
  }),
  whitespaceArbitrary.map((raw) => ({
    raw,
    expected: { kind: 'unspecified' } as const,
    entries: [],
  })),
  valuesCaseArbitrary,
);

describe('catalog URL normalization properties', () => {
  it('preserves ordered tri-state URL-field meaning', () => {
    // Feature: delaware-scene-full-stack-clone, Property 2: URL-field normalization preserves ordered tri-state meaning
    // **Validates: Requirements 2.8, 2.9, 2.10, 2.11, 2.12, 2.13**
    fc.assert(
      fc.property(urlFieldCaseArbitrary, ({ raw, expected, entries }) => {
        const result = normalizeUrlField(raw, {
          required: false,
          fieldName: 'Event Page',
          fileName: 'Government Events.csv',
          physicalRow: 2,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toEqual(expected);
        if (result.value.kind !== 'values') {
          expect(entries).toEqual([]);
          return;
        }
        expect(result.value.values).toHaveLength(entries.length);
        entries.forEach((entry, index) => {
          const normalized = result.value.kind === 'values' ? result.value.values[index] : undefined;
          expect(normalized).toBe(entry.normalized);
          expect(new URL(normalized as string).protocol).toBe(
            entry.inputScheme === 'bare' ? 'https:' : `${entry.inputScheme}:`,
          );
        });
      }),
    );
  });
});
