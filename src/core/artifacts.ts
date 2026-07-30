import * as fs from 'fs';
import * as path from 'path';
import { artifactRoot } from './screen.js';

export interface TestFolder {
  name: string;
  path: string;
  created: boolean;
}

/** Create (or reuse) a folder for the artifacts of a test run. */
export function createTestFolder(testName: string): TestFolder {
  const folder = path.join(artifactRoot(), testName);
  const existed = fs.existsSync(folder);

  fs.mkdirSync(folder, { recursive: true });

  return { name: testName, path: folder, created: !existed };
}

/** List the artifacts collected for a test run. */
export function listArtifacts(testName: string): string[] {
  const folder = path.join(artifactRoot(), testName);

  if (!fs.existsSync(folder)) {
    return [];
  }

  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(folder, entry.name))
    .sort();
}
