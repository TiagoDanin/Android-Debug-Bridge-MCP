# Agent skills

Two skills ship with this package, one per surface:

| Skill | Surface | Use when |
|-------|---------|----------|
| [`adb-cli`](./adb-cli/SKILL.md) | `adb-agent` CLI | The flow is a sequence of steps to chain in a shell call, or it runs in a script/CI job |
| [`adb-mcp`](./adb-mcp/SKILL.md) | MCP server tools | Screenshots should render inline in the conversation |

Both drive the same engine, so a flow written against one translates almost
literally to the other.

## Installing

Skills are plain folders holding a `SKILL.md`. Copy the one you want (or both)
into a skills directory your agent reads:

```bash
# Claude Code — for this project only
mkdir -p .claude/skills
cp -r node_modules/android-debug-bridge-mcp/skills/adb-cli .claude/skills/
cp -r node_modules/android-debug-bridge-mcp/skills/adb-mcp .claude/skills/

# Claude Code — for every project
cp -r node_modules/android-debug-bridge-mcp/skills/adb-cli ~/.claude/skills/
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force .claude\skills
Copy-Item -Recurse node_modules\android-debug-bridge-mcp\skills\adb-cli .claude\skills\
Copy-Item -Recurse node_modules\android-debug-bridge-mcp\skills\adb-mcp .claude\skills\
```

Codex, Cursor and other agents that read `SKILL.md` folders work the same way —
point them at the folder, or paste the file contents into their instructions.

## Reading a skill without installing it

The CLI prints these files, so an agent that has the CLI but not the skill
installed can still read them without hunting for the path:

```bash
adb-agent skills list
adb-agent skills get adb-cli
```

Set `ADB_SKILLS_DIR` to serve the files from somewhere else.
