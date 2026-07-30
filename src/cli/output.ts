export interface CommandResult {
  /** Human-readable output for terminal use. */
  summary: string;
  /** Structured payload emitted under `--json`. */
  data?: unknown;
}

export interface JsonEnvelope {
  ok: boolean;
  command: string;
  data?: unknown;
  summary?: string;
  error?: { message: string; name?: string };
}

export function writeStdout(value: string): void {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
}

export function writeStderr(value: string): void {
  process.stderr.write(value.endsWith('\n') ? value : `${value}\n`);
}

export function emitResult(command: string, result: CommandResult, json: boolean, quiet = false): void {
  if (json) {
    const envelope: JsonEnvelope = {
      ok: true,
      command,
      summary: result.summary,
      ...(result.data === undefined ? {} : { data: result.data }),
    };
    writeStdout(JSON.stringify(envelope));
    return;
  }

  if (!quiet && result.summary) {
    writeStdout(result.summary);
  }
}

export function emitError(command: string, error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : undefined;

  if (json) {
    const envelope: JsonEnvelope = { ok: false, command, error: { message, ...(name ? { name } : {}) } };
    writeStdout(JSON.stringify(envelope));
    return;
  }

  writeStderr(`error: ${message}`);
}
