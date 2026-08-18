import { createHash } from 'node:crypto';
import {
  AUTHORITATIVE_FILE_NAMES,
  CATEGORY_BY_FILE,
  type AuthoritativeCatalogFileName,
  type CanonicalSourceRecord,
  type Result,
  type SourceCategory,
  type UrlField,
  type ValidationIssue,
} from '@delaware-scene/domain';

export interface CsvRow {
  fields: string[];
  physicalRow: number;
}

export interface CatalogImportResult {
  fileName: AuthoritativeCatalogFileName;
  category: SourceCategory;
  records: CanonicalSourceRecord[];
  physicalRowCount: number;
}

export interface CatalogRepository {
  replaceCategory(category: SourceCategory, records: readonly CanonicalSourceRecord[]): Promise<void>;
}

function csvError(message: string, physicalRow: number): Result<CsvRow[]> {
  return {
    ok: false,
    errors: [{ path: 'csv', code: 'invalid_csv', message, physicalRow }],
  };
}

export function decodeUtf8Catalog(bytes: Uint8Array): Result<string> {
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return {
      ok: false,
      errors: [
        {
          path: 'csv',
          code: 'invalid_encoding',
          message: 'Catalog bytes must be valid UTF-8.',
        },
      ],
    };
  }
}

export function parseRfc4180(text: string): Result<CsvRow[]> {
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (input.length === 0) return { ok: true, value: [] };

  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let closedQuote = false;
  let physicalLine = 1;
  let rowStart = 1;

  const finishField = (): void => {
    fields.push(field);
    field = '';
    closedQuote = false;
  };
  const finishRow = (): void => {
    finishField();
    rows.push({ fields, physicalRow: rowStart });
    fields = [];
    rowStart = physicalLine;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) break;

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else if (character === '\r') {
        if (input[index + 1] === '\n') index += 1;
        field += '\n';
        physicalLine += 1;
      } else if (character === '\n') {
        field += '\n';
        physicalLine += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      return csvError('Unexpected character after a closing quote.', physicalLine);
    }
    if (character === '"') {
      if (field.length > 0) return csvError('Quote appeared inside an unquoted field.', physicalLine);
      inQuotes = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      physicalLine += 1;
      finishRow();
      rowStart = physicalLine;
    } else {
      field += character;
    }
  }

  if (inQuotes) return csvError('Quoted field was not terminated.', rowStart);
  if (field.length > 0 || fields.length > 0 || closedQuote) finishRow();
  return { ok: true, value: rows };
}

function isValidDomain(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.includes('.')) return false;
  return hostname.split('.').every((label) =>
    /^(?!-)[a-z0-9-]{1,63}(?<!-)$/iu.test(label),
  );
}

export function normalizeAbsoluteHttpUrl(raw: string): Result<string> {
  const value = raw.trim();
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (value.length === 0 || hasControlCharacter) {
    return {
      ok: false,
      errors: [{ path: 'url', code: 'invalid_url', message: 'URL is empty or contains control characters.' }],
    };
  }

  const explicitScheme = /^[a-z][a-z0-9+.-]*:/iu.test(value);
  if (explicitScheme && !/^https?:\/\//iu.test(value)) {
    return {
      ok: false,
      errors: [{ path: 'url', code: 'invalid_url_scheme', message: 'Only HTTP and HTTPS URLs are accepted.' }],
    };
  }

  try {
    const url = new URL(explicitScheme ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !isValidDomain(url.hostname)) {
      throw new Error('Unsupported protocol or host.');
    }
    if (url.username || url.password) throw new Error('User information is not permitted in URLs.');
    return { ok: true, value: url.href };
  } catch {
    return {
      ok: false,
      errors: [{ path: 'url', code: 'invalid_url', message: 'URL cannot be normalized to absolute HTTP(S).' }],
    };
  }
}

export function normalizeUrlField(
  raw: string,
  options: { required: boolean; fieldName: string; fileName?: string; physicalRow?: number },
): Result<UrlField> {
  const trimmed = raw.trim();
  if (trimmed === 'NKS') {
    if (options.required) {
      return {
        ok: false,
        errors: [
          {
            path: options.fieldName,
            code: 'missing_required_field',
            message: `${options.fieldName} must contain at least one URL.`,
            fileName: options.fileName,
            physicalRow: options.physicalRow,
          },
        ],
      };
    }
    return { ok: true, value: { kind: 'known-absence' } };
  }
  if (trimmed.length === 0) {
    if (options.required) {
      return {
        ok: false,
        errors: [
          {
            path: options.fieldName,
            code: 'missing_required_field',
            message: `${options.fieldName} is required.`,
            fileName: options.fileName,
            physicalRow: options.physicalRow,
          },
        ],
      };
    }
    return { ok: true, value: { kind: 'unspecified' } };
  }

  const pieces = raw.split(';').map((entry) => entry.trim()).filter(Boolean);
  const values: string[] = [];
  const errors: ValidationIssue[] = [];
  for (const piece of pieces) {
    const normalized = normalizeAbsoluteHttpUrl(piece);
    if (normalized.ok) values.push(normalized.value);
    else {
      errors.push({
        path: options.fieldName,
        code: 'invalid_url',
        message: `Invalid URL entry: ${piece}`,
        fileName: options.fileName,
        physicalRow: options.physicalRow,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  if (values.length === 0) {
    if (options.required) {
      return {
        ok: false,
        errors: [
          {
            path: options.fieldName,
            code: 'missing_required_field',
            message: `${options.fieldName} must contain at least one URL.`,
            fileName: options.fileName,
            physicalRow: options.physicalRow,
          },
        ],
      };
    }
    return { ok: true, value: { kind: 'unspecified' } };
  }
  return { ok: true, value: { kind: 'values', values } };
}

function findHeaderIndex(headers: readonly string[], accepted: readonly string[]): number {
  return headers.findIndex((header) => accepted.includes(header.trim()));
}

function sourceId(fileName: string, physicalRow: number, organizationName: string): string {
  const bytes = createHash('sha256')
    .update(`${fileName}\u0000${physicalRow}\u0000${organizationName}`, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function unknownFileError(fileName: string): Result<CatalogImportResult> {
  return {
    ok: false,
    errors: [
      {
        path: 'fileName',
        code: 'unknown_catalog_file',
        message: 'File name is not one of the four authoritative catalog names.',
        fileName,
      },
    ],
  };
}

export function parseAuthoritativeCatalog(fileName: string, text: string): Result<CatalogImportResult> {
  if (!AUTHORITATIVE_FILE_NAMES.includes(fileName as AuthoritativeCatalogFileName)) {
    return unknownFileError(fileName);
  }
  const authoritativeName = fileName as AuthoritativeCatalogFileName;
  const category = CATEGORY_BY_FILE[authoritativeName];
  if (text.length === 0) {
    if (category === 'library' || category === 'government') {
      return { ok: true, value: { fileName: authoritativeName, category, records: [], physicalRowCount: 0 } };
    }
    return {
      ok: false,
      errors: [
        {
          path: 'header',
          code: 'missing_header',
          message: 'A populated authoritative category cannot be imported from a zero-byte file.',
          fileName,
          physicalRow: 1,
        },
      ],
    };
  }

  const parsed = parseRfc4180(text);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((error) => ({ ...error, fileName })),
    };
  }
  const [headerRow, ...dataRows] = parsed.value;
  if (!headerRow) {
    return {
      ok: false,
      errors: [{ path: 'header', code: 'missing_header', message: 'CSV header is required.', fileName }],
    };
  }

  const headers = headerRow.fields.map((field) => field.trim());
  const organizationNameIndex = findHeaderIndex(headers, ['Organization Name']);
  const organizationUrlIndex = findHeaderIndex(headers, ['Organization URL']);
  const sitemapIndex = findHeaderIndex(headers, ['Site Map', 'Sitemap']);
  const eventIndex = findHeaderIndex(headers, ['Events', 'Event Page']);
  const expected = [
    ['Organization Name', organizationNameIndex],
    ['Organization URL', organizationUrlIndex],
    ['Sitemap', sitemapIndex],
    ['Event Page', eventIndex],
  ] as const;
  const headerErrors = expected
    .filter(([, index]) => index < 0)
    .map(([field]) => ({
      path: field,
      code: 'missing_column',
      message: `Required column ${field} is missing.`,
      fileName,
      physicalRow: 1,
    }));
  if (headerErrors.length > 0) return { ok: false, errors: headerErrors };

  const widthErrors = dataRows
    .filter((row) => row.fields.some((field) => field.trim().length > 0))
    .filter((row) => row.fields.length !== headers.length)
    .map((row) => ({
      path: 'csv',
      code: 'invalid_csv',
      message: `CSV record has ${row.fields.length} fields; expected ${headers.length}.`,
      fileName,
      physicalRow: row.physicalRow,
    }));
  if (widthErrors.length > 0) return { ok: false, errors: widthErrors };

  const records: CanonicalSourceRecord[] = [];
  const errors: ValidationIssue[] = [];
  let nonEmptyRows = 0;
  for (const row of dataRows) {
    if (row.fields.every((field) => field.trim().length === 0)) continue;
    nonEmptyRows += 1;
    const organizationName = (row.fields[organizationNameIndex] ?? '').trim();
    if (organizationName.length === 0) {
      errors.push({
        path: 'Organization Name',
        code: 'missing_required_field',
        message: 'Organization Name is required.',
        fileName,
        physicalRow: row.physicalRow,
      });
    }
    const organizationUrls = normalizeUrlField(row.fields[organizationUrlIndex] ?? '', {
      required: true,
      fieldName: 'Organization URL',
      fileName,
      physicalRow: row.physicalRow,
    });
    const sitemapUrls = normalizeUrlField(row.fields[sitemapIndex] ?? '', {
      required: false,
      fieldName: 'Sitemap',
      fileName,
      physicalRow: row.physicalRow,
    });
    const eventUrls = normalizeUrlField(row.fields[eventIndex] ?? '', {
      required: false,
      fieldName: 'Event Page',
      fileName,
      physicalRow: row.physicalRow,
    });
    if (!organizationUrls.ok) errors.push(...organizationUrls.errors);
    if (!sitemapUrls.ok) errors.push(...sitemapUrls.errors);
    if (!eventUrls.ok) errors.push(...eventUrls.errors);
    if (
      organizationName.length > 0 &&
      organizationUrls.ok &&
      sitemapUrls.ok &&
      eventUrls.ok
    ) {
      records.push({
        id: sourceId(fileName, row.physicalRow, organizationName),
        catalogFileName: fileName,
        physicalRow: row.physicalRow,
        sourceCategory: category,
        organizationName,
        organizationUrls: organizationUrls.value,
        sitemapUrls: sitemapUrls.value,
        eventUrls: eventUrls.value,
        collectionState: 'enabled',
      });
    }
  }
  if (errors.length > 0) {
    errors.sort((left, right) =>
      (left.physicalRow ?? 0) - (right.physicalRow ?? 0) ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
    );
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { fileName: authoritativeName, category, records, physicalRowCount: nonEmptyRows },
  };
}

function quoteCsv(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function serializeUrlField(field: UrlField): string {
  if (field.kind === 'known-absence') return 'NKS';
  if (field.kind === 'unspecified') return '';
  return field.values.join('; ');
}

export interface SourceCatalogSerializer {
  serialize(records: readonly CanonicalSourceRecord[]): string;
}

export class CanonicalSourceCatalogSerializer implements SourceCatalogSerializer {
  serialize(records: readonly CanonicalSourceRecord[]): string {
    return serializeCanonicalCatalog(records);
  }
}

export function serializeCanonicalCatalog(records: readonly CanonicalSourceRecord[]): string {
  const header = ['Source Category', 'Organization Name', 'Organization URL', 'Sitemap', 'Event Page'];
  const lines = [header.map(quoteCsv).join(',')];
  for (const record of records) {
    lines.push(
      [
        record.sourceCategory,
        record.organizationName,
        serializeUrlField(record.organizationUrls),
        serializeUrlField(record.sitemapUrls),
        serializeUrlField(record.eventUrls),
      ]
        .map(quoteCsv)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

const FILE_BY_CATEGORY: Record<SourceCategory, AuthoritativeCatalogFileName> = {
  'ddoa-grantee': 'DelawareScene Events Master List - DDOA-funded grantee websites.csv',
  'non-grantee': 'DelawareScene Events Master List - non-grantee Delaware venues and presenters.csv',
  library: 'Library Events.csv',
  government: 'Government Events.csv',
};

export function parseCanonicalCatalog(text: string): Result<CanonicalSourceRecord[]> {
  const parsed = parseRfc4180(text);
  if (!parsed.ok) return parsed;
  const [header, ...rows] = parsed.value;
  const expected = ['Source Category', 'Organization Name', 'Organization URL', 'Sitemap', 'Event Page'];
  if (!header || expected.some((value, index) => header.fields[index]?.trim() !== value)) {
    return {
      ok: false,
      errors: [{ path: 'header', code: 'missing_column', message: 'Canonical catalog header is invalid.' }],
    };
  }

  const records: CanonicalSourceRecord[] = [];
  const errors: ValidationIssue[] = [];
  for (const row of rows) {
    if (row.fields.every((field) => field.trim().length === 0)) continue;
    if (row.fields.length !== expected.length) {
      errors.push({
        path: 'csv',
        code: 'invalid_csv',
        message: `CSV record has ${row.fields.length} fields; expected ${expected.length}.`,
        physicalRow: row.physicalRow,
      });
      continue;
    }
    const category = row.fields[0]?.trim() as SourceCategory;
    if (!Object.hasOwn(FILE_BY_CATEGORY, category)) {
      errors.push({ path: 'Source Category', code: 'invalid_category', message: 'Source category is invalid.', physicalRow: row.physicalRow });
      continue;
    }
    const name = row.fields[1]?.trim() ?? '';
    const organization = normalizeUrlField(row.fields[2] ?? '', { required: true, fieldName: 'Organization URL', physicalRow: row.physicalRow });
    const sitemap = normalizeUrlField(row.fields[3] ?? '', { required: false, fieldName: 'Sitemap', physicalRow: row.physicalRow });
    const event = normalizeUrlField(row.fields[4] ?? '', { required: false, fieldName: 'Event Page', physicalRow: row.physicalRow });
    if (!name) errors.push({ path: 'Organization Name', code: 'missing_required_field', message: 'Organization Name is required.', physicalRow: row.physicalRow });
    if (!organization.ok) errors.push(...organization.errors);
    if (!sitemap.ok) errors.push(...sitemap.errors);
    if (!event.ok) errors.push(...event.errors);
    if (name && organization.ok && sitemap.ok && event.ok) {
      const fileName = FILE_BY_CATEGORY[category];
      records.push({
        id: sourceId(fileName, row.physicalRow, name),
        catalogFileName: fileName,
        physicalRow: row.physicalRow,
        sourceCategory: category,
        organizationName: name,
        organizationUrls: organization.value,
        sitemapUrls: sitemap.value,
        eventUrls: event.value,
        collectionState: 'enabled',
      });
    }
  }
  errors.sort((left, right) =>
    (left.physicalRow ?? 0) - (right.physicalRow ?? 0) ||
    left.path.localeCompare(right.path) ||
    left.code.localeCompare(right.code),
  );
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: records };
}

export class AtomicCatalogImporter {
  constructor(private readonly repository: CatalogRepository) {}

  async import(fileName: string, text: string): Promise<Result<CatalogImportResult>> {
    const parsed = parseAuthoritativeCatalog(fileName, text);
    if (!parsed.ok) return parsed;
    await this.repository.replaceCategory(parsed.value.category, parsed.value.records);
    return parsed;
  }
}
