import { Type, type Static, type TSchema } from '@sinclair/typebox';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type EventId = Brand<string, 'EventId'>;
export type OccurrenceId = Brand<string, 'OccurrenceId'>;
export type SourceRecordId = Brand<string, 'SourceRecordId'>;
export type SubmissionId = Brand<string, 'SubmissionId'>;
export type JobId = Brand<string, 'JobId'>;
export type AuditId = Brand<string, 'AuditId'>;

export function brandIdentifier<Name extends string>(value: string): Brand<string, Name> {
  if (value.trim().length === 0) throw new TypeError('Identifier must not be empty.');
  return value as Brand<string, Name>;
}

export const publicationStatuses = ['pending', 'published', 'rejected', 'archived'] as const;
export type PublicationStatus = (typeof publicationStatuses)[number];
export const sourceCategories = [
  'ddoa-grantee',
  'non-grantee',
  'library',
  'government',
] as const;
export type SourceCategory = (typeof sourceCategories)[number];

export interface ValidationField {
  path: string;
  code: string;
  message: string;
  rejectedValue?: unknown;
  physicalRow?: number;
  fileName?: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string;
    fields?: ValidationField[];
  };
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  previous: string | null;
  next: string | null;
}

export function createPageSchema<T extends TSchema>(itemSchema: T) {
  return Type.Object(
    {
      items: Type.Array(itemSchema),
      page: Type.Integer({ minimum: 1 }),
      pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
      totalCount: Type.Integer({ minimum: 0 }),
      totalPages: Type.Integer({ minimum: 0 }),
      previous: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      next: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    },
    { additionalProperties: false },
  );
}

export interface ExternalLinkDto {
  url: string;
  isExternal: true;
  label: string;
}

export type PublicOccurrenceDto =
  | {
      id: string;
      kind: 'date';
      startDate: string;
      endDate: string | null;
      originalStart: string;
      originalEnd: string | null;
    }
  | {
      id: string;
      kind: 'instant';
      startAt: string;
      endAt: string | null;
      sourceTimezone: string;
      localDate: string;
      localTime: string;
      originalStart: string;
      originalEnd: string | null;
    };

export interface PublicEventSummaryDto {
  id: string;
  occurrence: PublicOccurrenceDto;
  title: string;
  description: string | null;
  categories: string[];
  organization: string | null;
  venue: string | null;
  city: string | null;
  region: string | null;
  cost: string | null;
  audience: string | null;
  accessibility: string | null;
}

export interface PublicEventDetailDto extends Omit<PublicEventSummaryDto, 'occurrence'> {
  occurrences: PublicOccurrenceDto[];
  address: Record<string, string> | null;
  coordinates: { latitude: number; longitude: number } | null;
  source: ExternalLinkDto | null;
  ticket: ExternalLinkDto | null;
  registration: ExternalLinkDto | null;
  attribution: string | null;
  rightsNotice: string | null;
}

export interface SearchMetadataDto {
  categories: string[];
  regions: string[];
  organizations: string[];
  sourceCategories: SourceCategory[];
  costs: string[];
  audiences: string[];
  accessibility: string[];
}

export interface SourceSummaryDto {
  id: string;
  organizationName: string;
  sourceCategory: SourceCategory;
  collectionState: 'enabled' | 'disabled';
  discoveryUrls: string[];
}

export interface SessionDto {
  accountId: string;
  role: 'editor' | 'contributor';
  csrfToken: string;
  expiresAt: string;
}

export const ValidationFieldSchema = Type.Object(
  {
    path: Type.String(),
    code: Type.String(),
    message: Type.String(),
    rejectedValue: Type.Optional(Type.Unknown()),
    physicalRow: Type.Optional(Type.Integer({ minimum: 1 })),
    fileName: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ApiErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
        correlationId: Type.String({ minLength: 1 }),
        fields: Type.Optional(Type.Array(ValidationFieldSchema)),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const EventCollectionQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 12 })),
    q: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    category: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
    region: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
    organization: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
    cost: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
    audience: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
    accessibility: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  },
  { additionalProperties: false },
);

export type EventCollectionQueryContract = Static<typeof EventCollectionQuerySchema>;

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal('ok'), Type.Literal('unhealthy')]),
    service: Type.Literal('delaware-scene-clean-room'),
    version: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const LoginBodySchema = Type.Object(
  {
    accountId: Type.String({ minLength: 1, maxLength: 128 }),
    accessCode: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
);

export const ModerationReasonSchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 1000 }) },
  { additionalProperties: false },
);

export const RuntimeConfigurationSchema = Type.Object(
  {
    host: Type.String({ minLength: 1, maxLength: 255 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    publicOrigin: Type.String({ pattern: '^https?://' }),
    dataDirectory: Type.String({ minLength: 1 }),
    demoMode: Type.Boolean(),
    rateLimitMax: Type.Integer({ minimum: 1, maximum: 60 }),
    rateLimitWindowSeconds: Type.Integer({ minimum: 1, maximum: 60 }),
    retentionDays: Type.Integer({ minimum: 0, maximum: 3650 }),
    sourceFreshnessSeconds: Type.Integer({ minimum: 60, maximum: 2_592_000 }),
    defaultPageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    ingestionPageLimit: Type.Integer({ minimum: 1, maximum: 1000 }),
    releaseVersion: Type.String({ minLength: 1, maxLength: 128 }),
    databaseSecretName: Type.String({ minLength: 1, maxLength: 128 }),
    demoEditorSecretName: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export type RuntimeConfigurationContract = Static<typeof RuntimeConfigurationSchema>;

export const SecretReferenceSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 128 }),
    required: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const PageLimitSchema = Type.Integer({ minimum: 1, maximum: 1000 });
export const RetentionDaysSchema = Type.Integer({ minimum: 0, maximum: 3650 });
export const SourceFreshnessSecondsSchema = Type.Integer({ minimum: 60, maximum: 2_592_000 });

export * from './behavior-registry.js';
export * from './clean-room.js';
