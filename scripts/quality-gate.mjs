import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoots = ["src/js", "scripts", "tests"];
const extensions = new Set([".js", ".mjs"]);
const failures = [];
let inspected = 0;

async function visit(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await visit(relativePath);
    } else if (extensions.has(path.extname(entry.name))) {
      await inspect(relativePath);
    }
  }
}

async function inspect(relativePath) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  const activeLines = source.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("//");
  }).length;
  inspected += 1;
  if (activeLines > 600) failures.push(`${relativePath}: ${activeLines} non-blank, non-comment lines (limit 600)`);
}

for (const sourceRoot of sourceRoots) await visit(sourceRoot);
if (failures.length) throw new Error(`Code-quality gate failed:\n${failures.join("\n")}`);
console.log(`Code-quality gate inspected ${inspected} files; every file is within 600 active lines.`);
