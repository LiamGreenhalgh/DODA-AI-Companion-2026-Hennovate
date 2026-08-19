import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WorkspacePaths {
  rootDirectory: string;
  defaultDataDirectory: string;
  staticDirectory: string;
}

/**
 * Resolve runtime paths from the server module location so package-manager launch cwd does not
 * change which workspace data and web artifacts are used. This works from both src/ and dist/.
 */
export function resolveWorkspacePaths(moduleUrl: string = import.meta.url): WorkspacePaths {
  const rootDirectory = resolve(fileURLToPath(new URL('../../../', moduleUrl)));
  return {
    rootDirectory,
    defaultDataDirectory: join(rootDirectory, 'data', 'generated'),
    staticDirectory: join(rootDirectory, 'apps', 'web', 'dist'),
  };
}
