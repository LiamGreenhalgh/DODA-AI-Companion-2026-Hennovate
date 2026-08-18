import { loadAndValidateCleanRoomLedgers } from './lib/clean-room.js';

const result = await loadAndValidateCleanRoomLedgers();
console.log(
  `Validated ${result.behaviors.length} unique behavior records and ${result.assets.length} asset records.`,
);
