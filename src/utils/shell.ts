import * as fs from 'fs';
import { artifactRoot } from '../core/screen.js';

/**
 * Kept for backwards compatibility with earlier versions of this server.
 * New code should call the helpers in `src/core/` instead, which run adb with
 * an argument array rather than a shell string.
 */
export async function createDirectory(dirPath: string): Promise<void> {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function getBaseTestPath(): string {
  return artifactRoot();
}
