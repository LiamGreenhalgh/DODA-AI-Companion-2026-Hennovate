import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  IMPLEMENTED_BEHAVIORS,
  validateCleanRoomData,
  type AssetRecord,
  type BehaviorRecord,
} from '../../packages/contracts/src/index.js';

export interface LoadedCleanRoomLedgers {
  behaviors: BehaviorRecord[];
  assets: AssetRecord[];
}

export async function loadAndValidateCleanRoomLedgers(
  root = process.cwd(),
): Promise<LoadedCleanRoomLedgers> {
  const behaviorText = await readFile(join(root, 'clean-room', 'behaviors.yaml'), 'utf8');
  const assetText = await readFile(join(root, 'clean-room', 'assets.yaml'), 'utf8');
  const result = validateCleanRoomData(
    parse(behaviorText) as unknown,
    parse(assetText) as unknown,
    IMPLEMENTED_BEHAVIORS,
  );
  const errors = [...result.errors];
  for (const record of result.behaviors) {
    if (record.implementationStatus !== 'complete') continue;
    for (const evidence of record.evidence) {
      try {
        await access(join(root, evidence));
      } catch {
        errors.push(`${record.behaviorId}: evidence does not exist: ${evidence}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Clean-room validation failed:\n${errors.sort().join('\n')}`);
  }
  return { behaviors: result.behaviors, assets: result.assets };
}
