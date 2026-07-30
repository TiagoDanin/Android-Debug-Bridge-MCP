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
  -d, --device <serial>   Target device (default: ADB_SERIAL or the only device)
      --json              Emit a single JSON envelope: {ok, command, summary, data}
      --px                Read coordinates as pixels
      --norm              Read coordinates as 0..1 screen fractions
  -q, --quiet             Suppress the human-readable summary
  -h, --help              Show help
  -v, --version           Show the version

COORDINATES
  Values between 0 and 1 are screen fractions, so \`input tap 0.5 0.7\` taps the
  middle-lower area of any screen size. Larger values are pixels. Force either
  reading with --norm or --px.

ENVIRONMENT
  ADB_PATH          Path to the adb binary (default: adb from PATH)
  ADB_SERIAL        Default device serial
  ADB_SETTLE_MS     Delay after UI actions in ms (default 300)
  ADB_ARTIFACT_DIR  Where screenshots and recordings are written (default cwd)
  ADB_SKILLS_DIR    Override the folder holding the SKILL.md files

EXAMPLES
  ${BIN} doctor
  ${BIN} device list --json
  ${BIN} app launch com.android.settings
  ${BIN} ui find "Wi-Fi" --json
  ${BIN} ui tap "Wi-Fi"
  ${BIN} input tap 0.5 0.7
  ${BIN} input text "hello world" --submit
  ${BIN} screen shot --test login --step 001_home
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
