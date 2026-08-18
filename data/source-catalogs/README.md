# Authoritative catalog mirror

Run `corepack pnpm catalog:sync` to copy the four workspace-root inputs here byte-for-byte and record their SHA-256 hashes in `manifest.json`. Run `corepack pnpm catalog:import:all` to validate all four files without network access and atomically write canonical local state.
