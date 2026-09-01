import * as fs from 'fs';
import * as os from 'os';

export interface WorkingDirectoryStatus {
  /** Directory the process will use for relative paths and artifacts. */
  path: string;
  /** False when the original working directory was gone and we moved away. */
  ok: boolean;
  /** Where we recovered to, when `ok` is false. */
  movedTo: string | null;
}

let recovered: string | null = null;
let warned = false;

/**
 * `process.cwd()` throws `ENOENT: uv_cwd` when the directory the process was
 * started in no longer resolves. Under WSL that happens routinely: a Windows
 * path stops being reachable through /mnt, or an editor spawns the server from
 * a folder it then removes. Node keeps running but every fs call blows up.
 */
function readCwd(): string | null {
  try {
    const current = process.cwd();
    return current && fs.existsSync(current) ? current : null;
  } catch {
    return null;
  }
}

function fallbackCandidates(): string[] {
  const candidates = [
    process.env.ADB_ARTIFACT_DIR,
    process.env.ADB_FALLBACK_CWD,
    process.env.HOME,
    process.env.USERPROFILE,
    os.tmpdir(),
  ];

  return candidates.filter((entry): entry is string => Boolean(entry && entry.trim()));
}

/**
 * Make sure the process has a usable working directory, moving to the first
 * reachable fallback when it does not. Call this before anything touches the
 * filesystem — it is cheap and idempotent.
 */
export function ensureWorkingDirectory(): WorkingDirectoryStatus {
  const current = readCwd();

  if (current) {
    return { path: current, ok: true, movedTo: null };
  }

  if (recovered) {
    return { path: recovered, ok: false, movedTo: recovered };
  }

  for (const candidate of fallbackCandidates()) {
    try {
      process.chdir(candidate);
      recovered = readCwd() ?? candidate;
      break;
    } catch {
      // unreachable too — try the next candidate
    }
  }

  // Even chdir can fail everywhere; keep a path string so callers can still
  // build artifact paths instead of crashing.
  recovered = recovered ?? os.tmpdir();

  if (!warned) {
    warned = true;
    process.stderr.write(
      `adb-mcp: the working directory is not reachable (uv_cwd). Falling back to ${recovered}. ` +
        'Set ADB_ARTIFACT_DIR to choose where artifacts are written.\n'
    );
  }

  return { path: recovered, ok: false, movedTo: recovered };
}

/** Working directory that never throws — use instead of `process.cwd()`. */
export function safeCwd(): string {
  return readCwd() ?? ensureWorkingDirectory().path;
}

/** Report the state of the working directory, for `doctor`. */
export function workingDirectoryStatus(): WorkingDirectoryStatus {
  const current = readCwd();

  return current
    ? { path: current, ok: true, movedTo: null }
    : { path: recovered ?? os.tmpdir(), ok: false, movedTo: recovered };
}
