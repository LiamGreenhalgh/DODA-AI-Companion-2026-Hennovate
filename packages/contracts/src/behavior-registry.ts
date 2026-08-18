export const IMPLEMENTED_BEHAVIORS = [
  'foundation.health.v1',
  'catalog.authoritative-import.v1',
  'catalog.canonical-export.v1',
  'public.navigation.v1',
] as const;

export type ImplementedBehaviorId = (typeof IMPLEMENTED_BEHAVIORS)[number];
