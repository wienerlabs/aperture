import { readFileSync } from 'node:fs';
import path from 'node:path';

// Aperture repo root. Falls back to the parent of dashboard/ for local dev
// and to /app for container layouts where the repo is mounted at /app.
function repoRoot(): string {
  const explicit = process.env.APERTURE_REPO_ROOT?.trim();
  if (explicit && explicit.length > 0) return explicit;
  return path.resolve(process.cwd(), '..');
}

function readRepoFile(relative: string): { source: string; path: string } {
  const absolute = path.join(repoRoot(), relative);
  try {
    return { source: readFileSync(absolute, 'utf-8'), path: relative };
  } catch {
    return {
      source: `// Source file unavailable at build time: ${relative}`,
      path: relative,
    };
  }
}

export interface CodeSample {
  readonly source: string;
  readonly path: string;
}

export function readSample(relative: string): CodeSample {
  return readRepoFile(relative);
}

export function sliceSample(sample: CodeSample, startLine: number, endLine: number): CodeSample {
  const lines = sample.source.split('\n');
  const safeStart = Math.max(1, startLine) - 1;
  const safeEnd = Math.min(lines.length, endLine);
  return {
    source: lines.slice(safeStart, safeEnd).join('\n'),
    path: `${sample.path}:${startLine}-${safeEnd}`,
  };
}
