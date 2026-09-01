import { sleep } from '../utils/sleep.js';

/**
 * Pacing and reporting for a sequence of steps, shared by both surfaces.
 *
 * The engine knows nothing about commands or tools — each adapter supplies its
 * own executor. What lives here is the part both need and neither should get
 * subtly different: when to wait, when to stop, and the shape of the report.
 */

export interface BatchOptions {
  /**
   * Pause after a step that changed the screen, before the next one runs.
   * Defaults to ADB_BATCH_DELAY_MS, then 300ms.
   */
  delayMs?: number;
  /** Keep going after a failure instead of stopping at the first one. */
  continueOnError?: boolean;
}

/** What running a single step produced. */
export interface StepExecution {
  /** Identifier of what actually ran, e.g. `input.tap` or `input_tap`. */
  command?: string;
  summary?: string;
  data?: unknown;
  /**
   * Whether the step changed what is on screen. Only these are followed by the
   * pause: an action returns as soon as adb does, which on a tap that navigates
   * is before the new screen exists. Reads change nothing, so nothing waits.
   */
  mutates?: boolean;
}

export interface BatchStepResult {
  index: number;
  step: string;
  command?: string;
  ok: boolean;
  summary?: string;
  data?: unknown;
  error?: { message: string };
}

export interface BatchOutcome {
  steps: BatchStepResult[];
  failed: number;
  /** True when a failure ended the run early. */
  stopped: boolean;
  delayMs: number;
}

export interface BatchRunner<S> {
  /** Label for the report — the command line, or the tool name. */
  describe: (step: S, index: number) => string;
  execute: (step: S, index: number) => Promise<StepExecution>;
  /**
   * Steps that are themselves a pause. The automatic delay is skipped around
   * them: an explicit wait replaces it rather than stacking with it.
   */
  isPause?: (step: S) => boolean;
  /** Called after each step, for surfaces that stream progress (the CLI). */
  onStep?: (result: BatchStepResult, total: number) => void;
}

/** Pause between steps: explicit value, then ADB_BATCH_DELAY_MS, then 300ms. */
export function batchDelay(explicit?: number): number {
  if (explicit !== undefined) {
    if (!Number.isFinite(explicit)) {
      throw new Error(`delay must be a number of milliseconds, got "${explicit}"`);
    }

    return Math.max(explicit, 0);
  }

  const fromEnv = Number(process.env.ADB_BATCH_DELAY_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 300;
}

export async function runBatch<S>(
  steps: S[],
  runner: BatchRunner<S>,
  options: BatchOptions = {}
): Promise<BatchOutcome> {
  const delayMs = batchDelay(options.delayMs);
  const results: BatchStepResult[] = [];
  let failures = 0;
  /** Set by an action, consumed by the step that reads the screen after it. */
  let pending = 0;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const label = runner.describe(step, index);
    const isPause = runner.isPause?.(step) === true;

    if (pending > 0 && !isPause) {
      await sleep(pending);
    }

    pending = 0;

    try {
      const execution = await runner.execute(step, index);
      pending = execution.mutates ? delayMs : 0;

      const result: BatchStepResult = {
        index,
        step: label,
        ...(execution.command ? { command: execution.command } : {}),
        ok: true,
        ...(execution.summary === undefined ? {} : { summary: execution.summary }),
        ...(execution.data === undefined ? {} : { data: execution.data }),
      };

      results.push(result);
      runner.onStep?.(result, steps.length);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      const result: BatchStepResult = { index, step: label, ok: false, error: { message } };

      results.push(result);
      runner.onStep?.(result, steps.length);

      if (!options.continueOnError) {
        return { steps: results, failed: failures, stopped: true, delayMs };
      }
    }
  }

  return { steps: results, failed: failures, stopped: false, delayMs };
}

/** One-line report both surfaces print. */
export function describeBatch(outcome: BatchOutcome, total: number): string {
  return outcome.stopped
    ? `${outcome.steps.length - outcome.failed} of ${total} steps completed before failing`
    : `${total - outcome.failed}/${total} steps succeeded`;
}
