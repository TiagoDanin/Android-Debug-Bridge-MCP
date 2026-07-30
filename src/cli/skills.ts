import * as fs from 'fs';
import * as path from 'path';

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
}

export interface SkillDocument extends SkillSummary {
  content: string;
}

/**
 * Locate the `skills/` folder that ships with this package. Works from the
 * compiled `dist/cli` layout, from a source checkout, and from an explicit
 * ADB_SKILLS_DIR override.
 */
export function skillsDir(): string {
  const override = process.env.ADB_SKILLS_DIR;

  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`ADB_SKILLS_DIR points to a missing folder: ${override}`);
    }
    return override;
  }

  let current = __dirname;

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(current, 'skills');

    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    'Could not locate the skills/ folder. Set ADB_SKILLS_DIR to the folder that holds the SKILL.md files.'
  );
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) return {};

  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);

    if (!keyMatch) continue;

    const key = keyMatch[1];
    let value = keyMatch[2].trim();

    // Folded block scalars (`description: >`) continue on indented lines.
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const parts: string[] = [];

      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
        parts.push(lines[index + 1].trim());
        index += 1;
      }

      value = parts.join(' ');
    }

    fields[key] = value.replace(/^["']|["']$/g, '');
  }

  return fields;
}

export function listSkills(): SkillSummary[] {
  const root = skillsDir();

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(root, entry.name, 'SKILL.md');

      if (!fs.existsSync(file)) return null;

      const content = fs.readFileSync(file, 'utf8');
      const fields = parseFrontmatter(content);

      return {
        name: fields.name || entry.name,
        description: fields.description || '(no description)',
        path: file,
      };
    })
    .filter((entry): entry is SkillSummary => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkill(name: string): SkillDocument {
  const skills = listSkills();
  const match =
    skills.find((skill) => skill.name === name) ||
    skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase()) ||
    skills.find((skill) => skill.name.toLowerCase().includes(name.toLowerCase()));

  if (!match) {
    throw new Error(
      `Unknown skill "${name}". Available: ${skills.map((skill) => skill.name).join(', ') || 'none'}`
    );
  }

  return { ...match, content: fs.readFileSync(match.path, 'utf8') };
}
