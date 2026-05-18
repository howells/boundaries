import { readFile } from "node:fs/promises";

const skillPath = new URL("../skills/howells-boundaries/SKILL.md", import.meta.url);
const skill = await readFile(skillPath, "utf8");

if (!skill.startsWith("---\n")) {
  fail("SKILL.md must start with YAML frontmatter.");
}

const end = skill.indexOf("\n---\n", 4);
if (end === -1) {
  fail("SKILL.md frontmatter is not closed.");
}

const frontmatter = skill.slice(4, end);
for (const field of ["name:", "description:"]) {
  if (!frontmatter.includes(field)) {
    fail(`SKILL.md frontmatter is missing ${field}`);
  }
}

if (!skill.includes("boundaries init") || !skill.includes("boundaries check")) {
  fail("SKILL.md must document init and check workflows.");
}

process.stdout.write("Skill is valid.\n");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
