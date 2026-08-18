import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AuditRecord,
  ModerationRepository,
} from '@delaware-scene/application';
import type {
  CanonicalSourceRecord,
  EventRecord,
  PublicationStatus,
  SourceCategory,
} from '@delaware-scene/domain';
import type { CatalogRepository } from '@delaware-scene/ingestion';

export interface PersistedApplicationState {
  schemaVersion: 1;
  events: EventRecord[];
  sources: CanonicalSourceRecord[];
  audits: AuditRecord[];
  updatedAt: string;
}

const EMPTY_STATE: PersistedApplicationState = {
  schemaVersion: 1,
  events: [],
  sources: [],
  audits: [],
  updatedAt: '1970-01-01T00:00:00Z',
};

export class JsonStateStore {
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(readonly filePath: string) {}

  async read(): Promise<PersistedApplicationState> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as PersistedApplicationState;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.events) || !Array.isArray(parsed.sources)) {
        throw new Error('Persisted state has an unsupported shape.');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_STATE);
      throw error;
    }
  }

  async update(
    change: (state: PersistedApplicationState) => PersistedApplicationState | Promise<PersistedApplicationState>,
  ): Promise<PersistedApplicationState> {
    let result: PersistedApplicationState | undefined;
    const work = this.#writeQueue.then(async () => {
      const current = await this.read();
      result = await change(structuredClone(current));
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
    });
    this.#writeQueue = work.catch(() => undefined);
    await work;
    if (!result) throw new Error('State update did not produce a result.');
    return structuredClone(result);
  }
}

export class JsonEventRepository implements ModerationRepository {
  constructor(private readonly store: JsonStateStore) {}

  async list(): Promise<EventRecord[]> {
    return structuredClone((await this.store.read()).events);
  }

  async findById(id: string): Promise<EventRecord | null> {
    const event = (await this.store.read()).events.find((candidate) => candidate.id === id);
    return event ? structuredClone(event) : null;
  }

  async replaceAll(events: readonly EventRecord[]): Promise<void> {
    await this.store.update((state) => ({
      ...state,
      events: events.map((event) => structuredClone(event)),
      updatedAt: new Date().toISOString(),
    }));
  }

  async transition(input: {
    eventId: string;
    expectedVersion: number;
    from: PublicationStatus;
    to: PublicationStatus;
    audit: AuditRecord;
  }): Promise<EventRecord | null> {
    let changed: EventRecord | null = null;
    await this.store.update((state) => {
      const index = state.events.findIndex((event) => event.id === input.eventId);
      const current = state.events[index];
      if (!current || current.version !== input.expectedVersion || current.publicationStatus !== input.from) {
        return state;
      }
      changed = { ...current, publicationStatus: input.to, version: current.version + 1 };
      state.events[index] = changed;
      state.audits.push(structuredClone(input.audit));
      state.updatedAt = input.audit.actionTimestamp;
      return state;
    });
    return changed ? structuredClone(changed) : null;
  }

  async listAudits(): Promise<AuditRecord[]> {
    return structuredClone((await this.store.read()).audits);
  }
}

export class JsonCatalogRepository implements CatalogRepository {
  constructor(private readonly store: JsonStateStore) {}

  async replaceCategory(
    category: SourceCategory,
    records: readonly CanonicalSourceRecord[],
  ): Promise<void> {
    await this.store.update((state) => ({
      ...state,
      sources: [
        ...state.sources.filter((source) => source.sourceCategory !== category),
        ...structuredClone(records),
      ],
      updatedAt: new Date().toISOString(),
    }));
  }

  async listSources(): Promise<CanonicalSourceRecord[]> {
    return structuredClone((await this.store.read()).sources);
  }
}

export * from './postgres.js';
export * from './schema.js';
export * from './history.js';
export * from './jobs.js';
export * from './migrations.js';
export * from './catalog.js';
export * from './event-ingestion.js';
export * from './retention.js';