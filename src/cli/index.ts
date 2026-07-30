#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { AdbOptions } from '../core/adb.js';
import { CoordinateMode } from '../core/geometry.js';
import { FlagValue, flagBoolean, flagString, parseArgs, tokenize } from './args.js';
import { globalHelp, groupHelp } from './help.js';
import { CommandResult, emitError, emitResult, writeStdout } from './output.js';
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

async function runTokens(tokens: string[], globals: GlobalOptions): Promise<{ label: string; result: CommandResult }> {
  const { group, command, ctx } = buildContext(tokens, globals);
  const spec = findCommand(group, command);

  if (!spec) {
    throw new Error(`unknown command "${group} ${command}"`);
  }

  const result = await spec.run(ctx);
  return { label: `${group}.${command}`, result };
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

async function runBatch(argv: string[], globals: GlobalOptions): Promise<number> {
  const parsed = parseArgs(argv);
  const steps = readBatchSteps(parsed);
  const continueOnError = flagBoolean(parsed.flags, 'continue-on-error');
  const json = globals.json || flagBoolean(parsed.flags, 'json');

  if (steps.length === 0) {
    throw new Error(
      'batch needs at least one step: adb-agent batch "app launch com.example" "ui wait Login"'
    );
  }

  const results: Array<Record<string, unknown>> = [];
  let failures = 0;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];

    // `wait <ms>` is batch-local sugar for pausing between steps.
    const waitMatch = step.match(/^wait\s+(\d+)$/i);

    if (waitMatch) {
      const ms = Number(waitMatch[1]);
      await new Promise((resolve) => setTimeout(resolve, ms));
      results.push({ index, step, ok: true, summary: `waited ${ms}ms` });
      if (!json) writeStdout(`[${index + 1}/${steps.length}] ${step}\n  waited ${ms}ms`);
      continue;
    }

    try {
      const { label, result } = await runTokens(tokenize(step), { ...globals, json: false });
      results.push({
        index,
        step,
        command: label,
        ok: true,
        summary: result.summary,
        ...(result.data === undefined ? {} : { data: result.data }),
      });

      if (!json) {
        writeStdout(`[${index + 1}/${steps.length}] ${step}`);
        if (result.summary) {
          writeStdout(
            result.summary
              .split('\n')
              .map((line) => `  ${line}`)
              .join('\n')
          );
        }
      }
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ index, step, ok: false, error: { message } });

      if (!json) {
        writeStdout(`[${index + 1}/${steps.length}] ${step}`);
        process.stderr.write(`  error: ${message}\n`);
      }

      if (!continueOnError) {
        if (json) {
          writeStdout(
            JSON.stringify({
              ok: false,
              command: 'batch',
              summary: `${index} of ${steps.length} steps completed before failing`,
              data: { steps: results, failed: failures, stopped: true },
            })
          );
        }
        return 1;
      }
    }
  }

  if (json) {
    writeStdout(
      JSON.stringify({
        ok: failures === 0,
        command: 'batch',
        summary: `${steps.length - failures}/${steps.length} steps succeeded`,
        data: { steps: results, failed: failures, stopped: false },
      })
    );
  } else if (failures > 0) {
    process.stderr.write(`${failures} of ${steps.length} steps failed\n`);
  }

  return failures === 0 ? 0 : 1;
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
    return runBatch(argv, globals);
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
