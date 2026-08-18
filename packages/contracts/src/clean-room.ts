import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const ImplementationBasisSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('requirement'),
      Type.Literal('catalog'),
      Type.Literal('public-benchmark'),
      Type.Literal('independent'),
    ]),
    reference: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const BehaviorRecordSchema = Type.Object(
  {
    behaviorId: Type.String({ pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' }),
    observableBehavior: Type.String({ minLength: 1 }),
    implementationStatus: Type.Union([
      Type.Literal('not-started'),
      Type.Literal('in-progress'),
      Type.Literal('blocked'),
      Type.Literal('deferred'),
      Type.Literal('complete'),
    ]),
    basis: ImplementationBasisSchema,
    compatibility: Type.Union([
      Type.Literal('reproduced'),
      Type.Literal('independently-approximated'),
      Type.Literal('unsupported'),
    ]),
    inaccessibleDependencies: Type.Array(Type.String({ minLength: 1 })),
    observableDifferences: Type.Array(Type.String({ minLength: 1 })),
    evidence: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const BehaviorLedgerSchema = Type.Array(BehaviorRecordSchema);

export const AssetRecordSchema = Type.Object(
  {
    assetId: Type.String({ pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' }),
    usageLocations: Type.Array(Type.String({ minLength: 1 })),
    source: Type.String({ minLength: 1 }),
    permissionBasis: Type.Union([
      Type.Literal('original-project-work'),
      Type.Literal('system-provided-no-redistribution'),
      Type.Literal('documented-license'),
      Type.Literal('public-domain'),
      Type.Literal('none'),
    ]),
    attribution: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    copyrightNotice: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    substituteFor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    included: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AssetLedgerSchema = Type.Array(AssetRecordSchema);

export type BehaviorRecord = Static<typeof BehaviorRecordSchema>;
export type AssetRecord = Static<typeof AssetRecordSchema>;

export interface LedgerValidationResult {
  behaviors: BehaviorRecord[];
  assets: AssetRecord[];
  errors: string[];
}

function structuralErrors(schema: typeof BehaviorLedgerSchema | typeof AssetLedgerSchema, value: unknown, label: string): string[] {
  return [...Value.Errors(schema, value)].map(
    (error) => `${label}${error.path || '/'}: ${error.message}`,
  );
}

export function validateCleanRoomData(
  behaviorValue: unknown,
  assetValue: unknown,
  completedBehaviorRegistry: readonly string[],
): LedgerValidationResult {
  const errors = [
    ...structuralErrors(BehaviorLedgerSchema, behaviorValue, 'behaviors'),
    ...structuralErrors(AssetLedgerSchema, assetValue, 'assets'),
  ];
  if (!Value.Check(BehaviorLedgerSchema, behaviorValue) || !Value.Check(AssetLedgerSchema, assetValue)) {
    return { behaviors: [], assets: [], errors };
  }

  const behaviors = behaviorValue;
  const assets = assetValue;
  const counts = new Map<string, number>();
  for (const record of behaviors) {
    counts.set(record.behaviorId, (counts.get(record.behaviorId) ?? 0) + 1);
    if (
      record.compatibility === 'independently-approximated' &&
      (record.inaccessibleDependencies.length === 0 || record.observableDifferences.length === 0)
    ) {
      errors.push(
        `${record.behaviorId}: independent approximations require inaccessible dependencies and observable differences`,
      );
    }
    if (
      record.compatibility === 'unsupported' &&
      (record.inaccessibleDependencies.length === 0 || record.observableDifferences.length === 0)
    ) {
      errors.push(`${record.behaviorId}: unsupported behavior requires dependencies and differences`);
    }
    if (record.compatibility === 'reproduced' && record.observableDifferences.length > 0) {
      errors.push(`${record.behaviorId}: reproduced behavior cannot declare observable differences`);
    }
    if (record.implementationStatus === 'complete' && record.evidence.length === 0) {
      errors.push(`${record.behaviorId}: completed behavior requires evidence`);
    }
  }
  for (const [behaviorId, count] of counts) {
    if (count !== 1) errors.push(`${behaviorId}: behavior ID must appear exactly once`);
  }

  const registered = new Set(completedBehaviorRegistry);
  for (const behaviorId of registered) {
    const matching = behaviors.filter(
      (record) => record.behaviorId === behaviorId && record.implementationStatus === 'complete',
    );
    if (matching.length !== 1) {
      errors.push(`${behaviorId}: expected exactly one completed ledger record, found ${matching.length}`);
    }
  }
  for (const record of behaviors) {
    if (record.implementationStatus === 'complete' && !registered.has(record.behaviorId)) {
      errors.push(`${record.behaviorId}: completed behavior is absent from the behavior registry`);
    }
  }

  const assetCounts = new Map<string, number>();
  for (const asset of assets) {
    assetCounts.set(asset.assetId, (assetCounts.get(asset.assetId) ?? 0) + 1);
    if (asset.included && asset.permissionBasis === 'none') {
      errors.push(`${asset.assetId}: asset without permission must be excluded`);
    }
    if (!asset.included && asset.usageLocations.length > 0) {
      errors.push(`${asset.assetId}: excluded asset cannot have usage locations`);
    }
    if (asset.substituteFor && asset.permissionBasis === 'none') {
      errors.push(`${asset.assetId}: substitute requires a permission basis`);
    }
  }
  for (const [assetId, count] of assetCounts) {
    if (count !== 1) errors.push(`${assetId}: asset ID must appear exactly once`);
  }

  errors.sort((left, right) => left.localeCompare(right));
  return { behaviors, assets, errors };
}

export function includedAssets(records: readonly AssetRecord[]): AssetRecord[] {
  return records.filter((record) => record.included && record.permissionBasis !== 'none');
}
