export type FlagValue = string | boolean;

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, FlagValue>;
  /** Repeated flags, e.g. --extra k=v --extra a=b */
  repeated: Record<string, string[]>;
}

/**
 * Flags that never take a value. Everything else consumes the next token,
 * which keeps parsing predictable without a per-command schema.
 */
const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'version',
  'quiet',
  'raw',
  'no-ui',
  'ui',
  'px',
  'pixels',
  'norm',
  'normalized',
  'clickable',
  'exact',
  'submit',
  'reinstall',
  'grant',
  'downgrade',
  'test-apk',
  'keep-data',
  'clear',
  'base64',
  'continue-on-error',
  'system',
  'third-party',
]);

const ALIASES: Record<string, string> = {
  d: 'device',
  h: 'help',
  v: 'version',
  q: 'quiet',
  j: 'json',
  o: 'out',
  n: 'limit',
};

export function isBooleanFlag(name: string): boolean {
  return BOOLEAN_FLAGS.has(name);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};
  const repeated: Record<string, string[]> = {};
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (passthrough) {
      positionals.push(token);
      continue;
    }

    if (token === '--') {
      passthrough = true;
      continue;
    }

    if (token.startsWith('--') || (token.startsWith('-') && token.length === 2 && !/^-\d/.test(token))) {
      const raw = token.startsWith('--') ? token.slice(2) : token.slice(1);
      const equals = raw.indexOf('=');
      const name = ALIASES[equals === -1 ? raw : raw.slice(0, equals)] ?? (equals === -1 ? raw : raw.slice(0, equals));
      const inlineValue = equals === -1 ? undefined : raw.slice(equals + 1);

      if (inlineValue !== undefined) {
        assign(flags, repeated, name, inlineValue);
        continue;
      }

      if (isBooleanFlag(name)) {
        flags[name] = true;
        continue;
      }

      const next = argv[index + 1];

      if (next === undefined || (next.startsWith('--') && next.length > 2)) {
        flags[name] = true;
        continue;
      }

      assign(flags, repeated, name, next);
      index += 1;
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags, repeated };
}

function assign(
  flags: Record<string, FlagValue>,
  repeated: Record<string, string[]>,
  name: string,
  value: string
): void {
  if (name in flags) {
    const existing = flags[name];
    repeated[name] = repeated[name] ?? (typeof existing === 'string' ? [existing] : []);
    repeated[name].push(value);
  } else {
    repeated[name] = [value];
  }

  flags[name] = value;
}

/** Split a command line into tokens, honouring single and double quotes. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0 || hasContent) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0 || hasContent) {
    tokens.push(current);
  }

  if (quote) {
    throw new Error(`Unbalanced ${quote} quote in: ${line}`);
  }

  return tokens;
}

export function flagString(flags: Record<string, FlagValue>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagNumber(flags: Record<string, FlagValue>, name: string): number | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} expects a number, got "${value}"`);
  }

  return parsed;
}

export function flagBoolean(flags: Record<string, FlagValue>, name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}

/** Read an on/off/true/false style positional. */
export function parseToggleValue(value: string | undefined, label: string): boolean {
  const normalized = (value ?? '').trim().toLowerCase();

  if (['on', 'true', '1', 'enable', 'enabled', 'yes'].includes(normalized)) return true;
  if (['off', 'false', '0', 'disable', 'disabled', 'no'].includes(normalized)) return false;

  throw new Error(`${label} expects on|off, got "${value ?? ''}"`);
}
