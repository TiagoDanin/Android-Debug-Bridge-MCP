import { registry } from './registry.js';

const BIN = 'adb-agent';

export function globalHelp(version: string): string {
  const groups = Object.entries(registry)
    .map(([name, group]) => `  ${name.padEnd(10)} ${group.summary}`)
    .join('\n');

  return `${BIN} ${version} — drive an Android device or emulator from the shell.

USAGE
  ${BIN} <group> <command> [arguments] [flags]
  ${BIN} batch "<command>" "<command>"…      run several commands in order
  ${BIN} <group> --help                      list the commands of a group

GROUPS
${groups}
  batch      Run a sequence of commands, stopping at the first failure

GLOBAL FLAGS
  -d, --device <ref>      Target device by serial, serial prefix, transport id
                          or model (default: ADB_SERIAL or the only device)
      --json              Emit a single JSON envelope: {ok, command, summary, data}
      --px                Read coordinates as pixels
      --norm              Read coordinates as 0..1 screen fractions
  -q, --quiet             Suppress the human-readable summary
  -h, --help              Show help
  -v, --version           Show the version

BATCH
  \`batch\` runs several commands in one process, in the shape an agent works in:
  print -> action -> print. It pauses 300ms after each action, before the next
  step reads the screen, because a command returns as soon as adb does — on a
  tap that navigates, before the new screen exists. Reads (shot, dump, find,
  logcat) change nothing, so nothing waits after them.

  Override with --delay <ms> (--delay 0 to run flat out), or set
  ADB_BATCH_DELAY_MS. A \`wait <ms>\` step is an explicit pause and replaces the
  automatic one rather than adding to it. For a screen that loads over the
  network, prefer \`ui wait <query>\` — waiting for content beats waiting for a
  clock.

COORDINATES
  Values between 0 and 1 are screen fractions, so \`input tap 0.5 0.7\` taps the
  middle-lower area of any screen size. Larger values are pixels. Force either
  reading with --norm or --px.

MULTIPLE DEVICES
  With more than one device connected, every command needs to know which one:
  pass --device, set ADB_SERIAL, or run \`${BIN} device list\` to see the
  serials. The matcher accepts a prefix or a model name, so --device pixel
  works as well as --device emulator-5554.

SCREENSHOTS
  \`screen shot\` writes the full-resolution PNG to disk and prints a downscaled,
  compressed copy (--base64). Install the optional \`sharp\` dependency for JPEG
  and WebP output; without it a resized PNG is produced with Node's zlib alone.

  --mark-tap circles the last gesture on the returned image (--mark-last <n> for
  several, --mark <x,y> for a point of your own, --save-marked to write the
  annotated PNG next to the original). The device's own indicator, which
  \`input touches on\` enables, is drawn only while the finger is down: it lands
  in \`screen record\` but never in a screenshot taken afterwards.

ENVIRONMENT
  ADB_PATH                    Path to the adb binary (default: adb from PATH)
  ADB_SERIAL                  Default device (serial, prefix or model)
  ADB_DEVICE_CACHE_MS         How long the device list is cached (default 3000)
  ADB_SETTLE_MS               Delay after UI actions in ms (default 300)
  ADB_BATCH_DELAY_MS          Pause between batch steps in ms (default 300)
  ADB_ARTIFACT_DIR            Where artifacts are written (default cwd)
  ADB_FALLBACK_CWD            Directory to move to when the cwd is unusable
  ADB_SCREENSHOT_MAX_WIDTH    Screenshot output width (default 720, 0 = original)
  ADB_SCREENSHOT_QUALITY      Lossy quality 1..100 (default 60)
  ADB_SCREENSHOT_FORMAT       auto | jpeg | webp | png | none (default auto)
  ADB_MARKER_COLOR            Screenshot marker colour as hex (default #ff2d55)
  ADB_TOUCH_HISTORY           off keeps the gesture history in memory only
  ADB_TOUCH_HISTORY_FILE      Where the gesture history is stored
  ADB_SKILLS_DIR              Override the folder holding the SKILL.md files

EXAMPLES
  ${BIN} doctor
  ${BIN} device list --json
  ${BIN} --device pixel screen shot --max-width 540
  ${BIN} app launch com.android.settings
  ${BIN} ui find "Wi-Fi" --json
  ${BIN} ui tap "Wi-Fi"
  ${BIN} input tap 0.5 0.7
  ${BIN} input text "hello world" --submit
  ${BIN} screen shot --test login --step 001_home
  ${BIN} screen shot --mark-tap --save-marked
  ${BIN} emu finger touch 1
  ${BIN} batch "app restart com.example" "ui wait Login" "ui tap Login" --json

Run \`${BIN} skills get adb-cli\` for the full agent-facing guide.`;
}

export function groupHelp(groupName: string): string {
  const group = registry[groupName];

  if (!group) {
    return `Unknown group "${groupName}". Available: ${Object.keys(registry).join(', ')}`;
  }

  const commands = Object.entries(group.commands)
    .map(([name, spec]) => `  ${name.padEnd(14)} ${spec.summary}\n                 ${BIN} ${spec.usage}`)
    .join('\n');

  return `${BIN} ${groupName} — ${group.summary}\n\n${commands}`;
}

export function commandList(): string {
  return Object.entries(registry)
    .flatMap(([groupName, group]) =>
      Object.keys(group.commands).map((command) => `${groupName} ${command}`)
    )
    .join('\n');
}
