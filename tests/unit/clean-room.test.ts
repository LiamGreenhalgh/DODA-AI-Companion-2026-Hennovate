import { describe, expect, it } from 'vitest';
import {
  includedAssets,
  validateCleanRoomData,
  type AssetRecord,
  type BehaviorRecord,
} from '@delaware-scene/contracts';

const behavior: BehaviorRecord = {
  behaviorId: 'test.behavior.v1',
  observableBehavior: 'A testable behavior.',
  implementationStatus: 'complete',
  basis: { kind: 'independent', reference: 'Test decision' },
  compatibility: 'reproduced',
  inaccessibleDependencies: [],
  observableDifferences: [],
  evidence: ['tests/unit/clean-room.test.ts'],
};

const asset: AssetRecord = {
  assetId: 'test.asset',
  usageLocations: ['tests/unit/clean-room.test.ts'],
  source: 'Independent fixture',
  permissionBasis: 'original-project-work',
  attribution: null,
  copyrightNotice: null,
  substituteFor: null,
  included: true,
};

describe('clean-room governance', () => {
  it('accepts exactly one registered complete behavior and a permitted asset', () => {
    const result = validateCleanRoomData([behavior], [asset], [behavior.behaviorId]);
    expect(result.errors).toEqual([]);
    expect(includedAssets(result.assets)).toEqual([asset]);
  });

  it('rejects duplicate completed records and incomplete approximation metadata', () => {
    const approximation: BehaviorRecord = {
      ...behavior,
      behaviorId: 'test.approximation.v1',
      compatibility: 'independently-approximated',
      inaccessibleDependencies: [],
      observableDifferences: [],
    };
    const result = validateCleanRoomData(
      [behavior, behavior, approximation],
      [asset],
      [behavior.behaviorId, approximation.behaviorId],
    );
    expect(result.errors.join('\n')).toContain('behavior ID must appear exactly once');
    expect(result.errors.join('\n')).toContain('independent approximations require');
  });

  it('excludes assets without permission and rejects unlicensed inclusion or substitution', () => {
    const unlicensed: AssetRecord = {
      ...asset,
      assetId: 'test.unlicensed',
      permissionBasis: 'none',
      included: true,
      substituteFor: 'Protected asset',
    };
    const result = validateCleanRoomData([behavior], [unlicensed], [behavior.behaviorId]);
    expect(result.errors.join('\n')).toContain('asset without permission must be excluded');
    expect(result.errors.join('\n')).toContain('substitute requires a permission basis');
    expect(includedAssets(result.assets)).toEqual([]);
  });

  it('rejects structurally unknown ledger properties', () => {
    const result = validateCleanRoomData(
      [{ ...behavior, extra: true }],
      [asset],
      [behavior.behaviorId],
    );
    expect(result.errors.some((error) => error.includes('Unexpected property'))).toBe(true);
  });
});
