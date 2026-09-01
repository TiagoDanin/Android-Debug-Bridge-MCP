#!/usr/bin/env node

import { ensureWorkingDirectory } from '../utils/cwd.js';

// A shell can outlive the directory it was started in — and under WSL a
// Windows path can vanish mid-session. Recover before any fs call.
ensureWorkingDirectory();

import * as fs from 'fs';
import * as path from 'path';
import { AdbOptions } from '../core/adb.js';
import { describeBatch, runBatch } from '../core/batch.js';
import { CoordinateMode } from '../core/geometry.js';
import { sleep } from '../utils/sleep.js';
import { FlagValue, flagBoolean, flagNumber, flagString, parseArgs, tokenize } from './args.js';
import { globalHelp, groupHelp } from './help.js';
import { CommandResult, emitError, emitResult, writeStderr, writeStdout } from './output.js';
import { CommandContext, findCommand, registry } from './registry.js';

interface GlobalOptions {
  json: boolean;
  quiet: boolean;
  device?: string;
  mode: CoordinateMode;
}

function readVersion(): string {
  let current = __dirname;

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(current, 'package.json');

    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed?.name && parsed?.version) {
          return String(parsed.version);
        }
      } catch {
        // keep walking up
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return '0.0.0';
}

function coordinateMode(flags: Record<string, FlagValue>): CoordinateMode {
  const pixels = flagBoolean(flags, 'px') || flagBoolean(flags, 'pixels');
  const normalized = flagBoolean(flags, 'norm') || flagBoolean(flags, 'normalized');

  if (pixels && normalized) {
    throw new Error('--px and --norm are mutually exclusive');
  }

  if (pixels) return 'pixels';
  if (normalized) return 'normalized';
  return 'auto';
}

function buildContext(
  tokens: string[],
  globals: GlobalOptions
): { group: string; command: string; ctx: CommandContext } {
  const parsed = parseArgs(tokens);
  const [group, maybeCommand, ...rest] = parsed.positionals;

  if (!group) {
    throw new Error('missing command');
  }

  const groupEntry = registry[group];

  if (!groupEntry) {
    throw new Error(
      `unknown command group "${group}". Available: ${Object.keys(registry).join(', ')}, batch`
    );
  }

  // Single-command groups (like `doctor`) can be invoked without a subcommand.
  const commandNames = Object.keys(groupEntry.commands);
  const usesImplicitCommand =
    maybeCommand === undefined || !(maybeCommand in groupEntry.commands);
  const command =
    usesImplicitCommand && commandNames.length === 1 ? commandNames[0] : maybeCommand ?? '';

  if (!command || !groupEntry.commands[command]) {
    const attempted = [group, maybeCommand].filter(Boolean).join(' ');
    throw new Error(`unknown command "${attempted}"\n\n${groupHelp(group)}`);
  }

  const positionals =
    usesImplicitCommand && commandNames.length === 1 ? parsed.positionals.slice(1) : rest;

  const device = flagString(parsed.flags, 'device') ?? globals.device;
  const adb: AdbOptions = device ? { device } : {};
  const localMode = coordinateMode(parsed.flags);

  const ctx: CommandContext = {
    positionals,
    flags: parsed.flags,
    repeated: parsed.repeated,
    adb,
    mode: localMode === 'auto' ? globals.mode : localMode,
    json: globals.json || flagBoolean(parsed.flags, 'json'),
  };

  return { group, command, ctx };
}

async function runTokens(
  tokens: string[],
  globals: GlobalOptions
): Promise<{ label: string; result: CommandResult; mutates: boolean }> {
  const { group, command, ctx } = buildContext(tokens, globals);
  const spec = findCommand(group, command);

  if (!spec) {
    throw new Error(`unknown command "${group} ${command}"`);
  }

  const result = await spec.run(ctx);
  return { label: `${group}.${command}`, result, mutates: spec.mutates === true };
}

function readBatchSteps(parsed: ReturnType<typeof parseArgs>): string[] {
  const file = flagString(parsed.flags, 'file');

  if (file) {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  const positionals = parsed.positionals.slice(1);

  if (positionals.length === 1 && positionals[0] === '-') {
    return fs
      .readFileSync(0, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  return positionals;
}

/** `wait 500` — batch-local sugar for pausing between steps. */
const WAIT_STEP = /^wait\s+(\d+)$/i;

/** `--delay <ms>`, validated here so a typo is an error and not a silent default. */
function delayFlag(flags: Record<string, FlagValue>): number | undefined {
  if (!('delay' in flags)) return undefined;

  const value = flagNumber(flags, 'delay');

  if (value === undefined) {
    throw new Error('--delay expects a number of milliseconds, e.g. --delay 500');
  }

  return value;
}

async function runBatchCommand(argv: string[], globals: GlobalOptions): Promise<number> {
  const parsed = parseArgs(argv);
  const steps = readBatchSteps(parsed);
  const json = globals.json || flagBoolean(parsed.flags, 'json');

  if (steps.length === 0) {
    throw new Error(
      'batch needs at least one step: adb-agent batch "app launch com.example" "ui wait Login"'
    );
  }

  const outcome = await runBatch(
    steps,
    {
      describe: (step) => step,
      isPause: (step) => WAIT_STEP.test(step),
      execute: async (step) => {
        const waitMatch = WAIT_STEP.exec(step);

        if (waitMatch) {
          const ms = Number(waitMatch[1]);
          await sleep(ms);
          return { summary: `waited ${ms}ms`, mutates: false };
        }

        const { label, result, mutates } = await runTokens(tokenize(step), {
          ...globals,
          json: false,
        });

        return { command: label, summary: result.summary, data: result.data, mutates };
      },
      onStep: (result, total) => {
        if (json) return;

        writeStdout(`[${result.index + 1}/${total}] ${result.step}`);

        if (result.error) {
          writeStderr(`  error: ${result.error.message}`);
          return;
        }

        if (result.summary) {
          writeStdout(
            result.summary
              .split('\n')
              .map((line) => `  ${line}`)
              .join('\n')
          );
        }
      },
    },
    { delayMs: delayFlag(parsed.flags), continueOnError: flagBoolean(parsed.flags, 'continue-on-error') }
  );

  if (json) {
    writeStdout(
      JSON.stringify({
        ok: outcome.failed === 0,
        command: 'batch',
        summary: describeBatch(outcome, steps.length),
        data: outcome,
      })
    );
  } else if (outcome.failed > 0) {
    writeStderr(`${outcome.failed} of ${steps.length} steps failed`);
  }

  return outcome.failed === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const preview = parseArgs(argv);
  const version = readVersion();

  const globals: GlobalOptions = {
    json: flagBoolean(preview.flags, 'json'),
    quiet: flagBoolean(preview.flags, 'quiet'),
    device: flagString(preview.flags, 'device'),
    mode: coordinateMode(preview.flags),
  };

  if (flagBoolean(preview.flags, 'version')) {
    writeStdout(version);
    return 0;
  }

  const [group] = preview.positionals;

  if (!group) {
    writeStdout(globalHelp(version));
    return flagBoolean(preview.flags, 'help') ? 0 : 1;
  }

  if (flagBoolean(preview.flags, 'help')) {
    writeStdout(group in registry ? groupHelp(group) : globalHelp(version));
    return 0;
  }

  if (group === 'help') {
    const target = preview.positionals[1];
    writeStdout(target && target in registry ? groupHelp(target) : globalHelp(version));
    return 0;
  }

  if (group === 'batch') {
    return runBatchCommand(argv, globals);
  }

  const { label, result } = await runTokens(argv, globals);
  emitResult(label, result, globals.json, globals.quiet);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    const preview = parseArgs(process.argv.slice(2));
    emitError(
      preview.positionals.slice(0, 2).join('.') || 'adb-agent',
      error,
      flagBoolean(preview.flags, 'json')
    );
    process.exit(1);
  });
