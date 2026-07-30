import { AdbError, AdbOptions, adbShell, shellQuote } from './adb.js';
import { sleep } from '../utils/sleep.js';
import {
  ProcessedUIData,
  UIElement,
  formatElementsForDisplay,
  inlineLabel,
  parseUIAutomatorXML,
} from '../utils/xmlParser.js';

const DUMP_PATH = '/sdcard/window_dump.xml';

export interface UIDump {
  xml: string;
  tree: ProcessedUIData;
}

export interface FindQuery {
  /** Free-text query matched against text, content-desc and resource-id. */
  query?: string;
  text?: string;
  contentDesc?: string;
  resourceId?: string;
  className?: string;
  /** Element category from the parser: button, input, text, switch… */
  type?: string;
  /** Only elements marked clickable. */
  clickableOnly?: boolean;
  /** Require a full (case-insensitive) match instead of a substring match. */
  exact?: boolean;
}

export interface MatchedElement extends UIElement {
  matchedOn: string;
  score: number;
}

/** Grab the UIAutomator XML for the current screen, retrying transient failures. */
export function dumpUIXml(attempts = 3, options: AdbOptions = {}): string {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      adbShell(`uiautomator dump ${DUMP_PATH}`, options);
      const xml = adbShell(`cat ${shellQuote(DUMP_PATH)}`, options);

      if (xml.includes('<hierarchy')) {
        return xml;
      }

      lastError = new AdbError(`UI dump returned unexpected content: ${xml.slice(0, 200)}`, [
        'shell',
        'uiautomator dump',
      ]);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AdbError('Failed to dump the UI hierarchy', ['shell', 'uiautomator dump']);
}

/** Dump and parse the current screen in one step. */
export async function dumpUI(options: AdbOptions = {}): Promise<UIDump> {
  const xml = dumpUIXml(3, options);
  const tree = await parseUIAutomatorXML(xml);
  return { xml, tree };
}

export function formatUI(tree: ProcessedUIData): string {
  return formatElementsForDisplay(tree);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function matchField(
  field: string,
  needle: string,
  exact: boolean
): { hit: boolean; score: number } {
  const haystack = normalize(field);
  const target = normalize(needle);

  if (!haystack || !target) return { hit: false, score: 0 };
  if (haystack === target) return { hit: true, score: 100 };
  if (exact) return { hit: false, score: 0 };
  if (haystack.startsWith(target)) return { hit: true, score: 80 };
  if (haystack.includes(target)) return { hit: true, score: 60 };

  return { hit: false, score: 0 };
}

/** Rank the elements of a parsed screen against a query. */
export function findElements(tree: ProcessedUIData, query: FindQuery): MatchedElement[] {
  const exact = query.exact === true;
  const candidates = tree.all.filter((element) => {
    if (query.type && element.type !== query.type) return false;
    if (query.clickableOnly && !element.clickable) return false;
    if (query.className && !normalize(element.className).includes(normalize(query.className))) {
      return false;
    }
    return true;
  });

  const matches: MatchedElement[] = [];

  for (const element of candidates) {
    const checks: Array<{ field: string; value: string; needle?: string; weight: number }> = [
      { field: 'text', value: element.text, needle: query.text ?? query.query, weight: 3 },
      {
        field: 'contentDesc',
        value: element.contentDesc,
        needle: query.contentDesc ?? query.query,
        weight: 2,
      },
      {
        field: 'resourceId',
        value: element.resourceId,
        needle: query.resourceId ?? query.query,
        weight: 1,
      },
    ];

    let best: { field: string; score: number } | null = null;

    for (const check of checks) {
      if (!check.needle) continue;
      const { hit, score } = matchField(check.value, check.needle, exact);
      if (hit) {
        const weighted = score + check.weight;
        if (!best || weighted > best.score) {
          best = { field: check.field, score: weighted };
        }
      }
    }

    const hasTextualQuery = Boolean(
      query.query || query.text || query.contentDesc || query.resourceId
    );

    if (!hasTextualQuery) {
      matches.push({ ...element, matchedOn: 'filters', score: element.clickable ? 10 : 5 });
      continue;
    }

    if (best) {
      const bonus = element.clickable ? 10 : 0;
      const enabledBonus = element.enabled ? 2 : 0;
      matches.push({ ...element, matchedOn: best.field, score: best.score + bonus + enabledBonus });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

/** Dump the screen and return ranked matches. */
export async function findOnScreen(
  query: FindQuery,
  options: AdbOptions = {}
): Promise<{ matches: MatchedElement[]; tree: ProcessedUIData }> {
  const { tree } = await dumpUI(options);
  return { matches: findElements(tree, query), tree };
}

/** Poll the screen until an element matches, or the timeout elapses. */
export async function waitForElement(
  query: FindQuery,
  timeoutMs = 10_000,
  intervalMs = 500,
  options: AdbOptions = {}
): Promise<{ matches: MatchedElement[]; waitedMs: number }> {
  const started = Date.now();

  do {
    const { matches } = await findOnScreen(query, options);
    if (matches.length > 0) {
      return { matches, waitedMs: Date.now() - started };
    }
    await sleep(intervalMs);
  } while (Date.now() - started < timeoutMs);

  const describe = query.query || query.text || query.resourceId || query.contentDesc || 'filters';
  throw new AdbError(
    `Timed out after ${timeoutMs}ms waiting for an element matching "${describe}"`,
    ['shell', 'uiautomator dump']
  );
}

/** Human-readable label for an element, used in CLI/MCP output. */
export function describeElement(element: UIElement): string {
  return inlineLabel(
    element.text?.trim() ||
      element.contentDesc?.trim() ||
      element.resourceId?.trim() ||
      element.className ||
      'unlabeled element'
  );
}

export interface TapPlan {
  point: { x: number; y: number };
  /** `center` when the element's center is free, `offset` when it was covered. */
  strategy: 'center' | 'offset';
  /** The clickable element sitting on top of every candidate point, if any. */
  occludedBy: UIElement | null;
}

type Bounds = UIElement['bounds'];

function containsPoint(bounds: Bounds, x: number, y: number): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

/**
 * True when `element` is a descendant of `ancestor` in the XML tree. Tested on
 * the path, never on geometry: a bottom bar can be drawn entirely inside a
 * banner's bounds while being a sibling that covers it.
 */
function isDescendantOf(element: UIElement, ancestor: UIElement): boolean {
  return element.path.startsWith(`${ancestor.path}.`);
}

/**
 * Clickable elements drawn after `target` that cover the given point. Children
 * of the target are excluded: they are part of it, not something on top of it.
 */
function occludersAt(target: UIElement, all: UIElement[], x: number, y: number): UIElement[] {
  return all
    .filter(
      (element) =>
        element.index > target.index &&
        element.clickable &&
        containsPoint(element.bounds, x, y) &&
        !isDescendantOf(element, target)
    )
    .sort((a, b) => b.index - a.index);
}

const CANDIDATE_FRACTIONS = [0.5, 0.3, 0.7, 0.15, 0.85];

/**
 * Pick where to tap an element.
 *
 * The center is the natural target, but a bottom bar, FAB or sticky banner can
 * be painted over it — UIAutomator reports the element's full logical bounds
 * with no notion of what is actually on top. Tapping the center then activates
 * the overlay while the caller believes it hit the element. So: try the center,
 * fall back to points inside the element that nothing covers, and report the
 * blocker when every candidate is covered.
 */
export function resolveTapPoint(target: UIElement, all: UIElement[]): TapPlan {
  const candidates: Array<{ x: number; y: number; distance: number }> = [];

  for (const fx of CANDIDATE_FRACTIONS) {
    for (const fy of CANDIDATE_FRACTIONS) {
      candidates.push({
        x: Math.round(target.bounds.left + target.size.width * fx),
        y: Math.round(target.bounds.top + target.size.height * fy),
        distance: Math.abs(fx - 0.5) + Math.abs(fy - 0.5),
      });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);

  for (const candidate of candidates) {
    if (occludersAt(target, all, candidate.x, candidate.y).length === 0) {
      const isCenter = candidate.distance === 0;
      return {
        point: isCenter ? target.center : { x: candidate.x, y: candidate.y },
        strategy: isCenter ? 'center' : 'offset',
        occludedBy: null,
      };
    }
  }

  const [blocker] = occludersAt(target, all, target.center.x, target.center.y);

  return { point: target.center, strategy: 'center', occludedBy: blocker ?? null };
}

export function formatMatches(matches: MatchedElement[], limit = 20): string {
  if (matches.length === 0) {
    return 'No matching elements found';
  }

  const lines = matches.slice(0, limit).map((element, index) => {
    const flags = [
      element.clickable ? 'clickable' : null,
      element.enabled ? null : 'disabled',
      element.scrollable ? 'scrollable' : null,
      element.checked ? 'checked' : null,
    ]
      .filter(Boolean)
      .join(', ');

    const details = [
      `type=${element.type}`,
      element.resourceId ? `id=${element.resourceId}` : null,
      flags ? `flags=${flags}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    return `  ${index + 1}. "${describeElement(element)}" at (${element.center.x}, ${element.center.y}) — ${details}`;
  });

  const suffix = matches.length > limit ? `\n  … ${matches.length - limit} more matches\n` : '\n';
  return `MATCHES (${matches.length}):\n${lines.join('\n')}${suffix}`;
}
