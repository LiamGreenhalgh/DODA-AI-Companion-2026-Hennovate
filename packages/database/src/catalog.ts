import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type {
  CanonicalSourceRecord,
  SourceCategory,
  UrlField,
} from '@delaware-scene/domain';
import type { CatalogRepository } from '@delaware-scene/ingestion';
import type { DatabaseSchema } from './schema.js';

function fingerprint(record: CanonicalSourceRecord): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        catalogFileName: record.catalogFileName,
        physicalRow: record.physicalRow,
        sourceCategory: record.sourceCategory,
        organizationName: record.organizationName,
        organizationUrls: record.organizationUrls,
        sitemapUrls: record.sitemapUrls,
        eventUrls: record.eventUrls,
      }),
      'utf8',
    )
    .digest('hex');
}

function kindField(
  record: CanonicalSourceRecord,
  kind: 'organization' | 'sitemap' | 'event',
): UrlField {
  if (kind === 'organization') return record.organizationUrls;
  if (kind === 'sitemap') return record.sitemapUrls;
  return record.eventUrls;
}

async function insertUrlField(
  transaction: Transaction<DatabaseSchema>,
  record: CanonicalSourceRecord,
  kind: 'organization' | 'sitemap' | 'event',
): Promise<void> {
  const field = kindField(record, kind);
  await transaction
    .insertInto('source_url_fields')
    .values({
      source_record_id: record.id,
      field_kind: kind,
      field_state: field.kind,
    })
    .execute();
  if (field.kind !== 'values') return;
  await transaction
    .insertInto('source_urls')
    .values(
      field.values.map((rawUrl, ordinal) => {
        const url = new URL(rawUrl);
        return {
          source_record_id: record.id,
          field_kind: kind,
          ordinal,
          url: rawUrl,
          scheme: url.protocol.slice(0, -1) as 'http' | 'https',
          host: url.hostname,
          last_etag: null,
          last_modified: null,
        };
      }),
    )
    .execute();
}

export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async replaceCategory(
    category: SourceCategory,
    records: readonly CanonicalSourceRecord[],
  ): Promise<void> {
    if (records.some((record) => record.sourceCategory !== category)) {
      throw new TypeError('Every catalog record must match the replaced source category.');
    }
    const ids = records.map((record) => record.id);
    await this.database.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom('source_records')
        .select(['id', 'collection_state'])
        .where('source_category', '=', category)
        .execute();
      const previousStates = new Map(existing.map((row) => [row.id, row.collection_state]));
      const staleIds = existing.map((row) => row.id).filter((id) => !ids.includes(id));
      if (staleIds.length > 0) {
        await transaction.deleteFrom('source_urls').where('source_record_id', 'in', staleIds).execute();
        await transaction
          .deleteFrom('source_url_fields')
          .where('source_record_id', 'in', staleIds)
          .execute();
        await transaction.deleteFrom('source_records').where('id', 'in', staleIds).execute();
      }
      if (ids.length > 0) {
        await transaction.deleteFrom('source_urls').where('source_record_id', 'in', ids).execute();
        await transaction
          .deleteFrom('source_url_fields')
          .where('source_record_id', 'in', ids)
          .execute();
      }
      for (const record of records) {
        const now = new Date();
        await transaction
          .insertInto('source_records')
          .values({
            id: record.id,
            catalog_file_name: record.catalogFileName,
            catalog_physical_row: record.physicalRow,
            source_category: record.sourceCategory,
            organization_name: record.organizationName,
            collection_state: previousStates.get(record.id) ?? 'enabled',
            adapter_key: null,
            import_fingerprint: fingerprint(record),
            last_success_at: null,
            updated_at: now,
          })
          .onConflict((conflict) =>
            conflict.column('id').doUpdateSet({
              catalog_file_name: record.catalogFileName,
              catalog_physical_row: record.physicalRow,
              source_category: record.sourceCategory,
              organization_name: record.organizationName,
              import_fingerprint: fingerprint(record),
              updated_at: now,
            }),
          )
          .execute();
        await insertUrlField(transaction, record, 'organization');
        await insertUrlField(transaction, record, 'sitemap');
        await insertUrlField(transaction, record, 'event');
      }
    });
  }

  async listSources(): Promise<CanonicalSourceRecord[]> {
    const [records, fields, urls] = await Promise.all([
      this.database
        .selectFrom('source_records')
        .selectAll()
        .orderBy('catalog_file_name', 'asc')
        .orderBy('catalog_physical_row', 'asc')
        .execute(),
      this.database.selectFrom('source_url_fields').selectAll().execute(),
      this.database
        .selectFrom('source_urls')
        .select(['source_record_id', 'field_kind', 'ordinal', 'url'])
        .orderBy('ordinal', 'asc')
        .execute(),
    ]);
    const fieldFor = (
      sourceRecordId: string,
      kind: 'organization' | 'sitemap' | 'event',
    ): UrlField => {
      const field = fields.find(
        (candidate) =>
          candidate.source_record_id === sourceRecordId && candidate.field_kind === kind,
      );
      if (!field) throw new Error(`Persisted source ${sourceRecordId} is missing ${kind} state.`);
      if (field.field_state !== 'values') return { kind: field.field_state };
      return {
        kind: 'values',
        values: urls
          .filter(
            (url) => url.source_record_id === sourceRecordId && url.field_kind === kind,
          )
          .map((url) => url.url),
      };
    };
    return records.map((record) => ({
      id: record.id,
      catalogFileName: record.catalog_file_name,
      physicalRow: record.catalog_physical_row,
      sourceCategory: record.source_category,
      organizationName: record.organization_name,
      organizationUrls: fieldFor(record.id, 'organization'),
      sitemapUrls: fieldFor(record.id, 'sitemap'),
      eventUrls: fieldFor(record.id, 'event'),
      collectionState: record.collection_state,
    }));
  }
}
