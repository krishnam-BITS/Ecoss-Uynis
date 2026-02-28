import { promises as fs } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const includeDirs = ['app', 'components', 'lib', 'src', 'scripts'];
const includeExt = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.md',
  '.mdx',
]);
const skipDirNames = new Set(['node_modules', '.next', '.next-dev', '.git']);

const decoder = new TextDecoder('utf-8', { fatal: true });
const errors = [];
let checked = 0;

async function walk(dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    errors.push({
      file: path.relative(rootDir, dirPath),
      reason: `unable to read directory (${error instanceof Error ? error.message : String(error)})`,
    });
    return;
  }

  for (const entry of entries) {
    if (skipDirNames.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!includeExt.has(ext)) {
      continue;
    }

    let bytes;
    try {
      bytes = await fs.readFile(fullPath);
    } catch (error) {
      errors.push({
        file: path.relative(rootDir, fullPath),
        reason: `unable to read file (${error instanceof Error ? error.message : String(error)})`,
      });
      continue;
    }

    checked += 1;
    const relPath = path.relative(rootDir, fullPath);

    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      errors.push({
        file: relPath,
        reason: 'UTF-8 BOM detected (file must be UTF-8 without BOM)',
      });
      continue;
    }

    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      errors.push({
        file: relPath,
        reason: 'UTF-16 LE BOM detected (file must be UTF-8 without BOM)',
      });
      continue;
    }

    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      errors.push({
        file: relPath,
        reason: 'UTF-16 BE BOM detected (file must be UTF-8 without BOM)',
      });
      continue;
    }

    try {
      decoder.decode(bytes);
    } catch {
      errors.push({
        file: relPath,
        reason: 'invalid UTF-8 byte sequence',
      });
    }
  }
}

for (const segment of includeDirs) {
  const dirPath = path.join(rootDir, segment);
  await walk(dirPath);
}

if (errors.length > 0) {
  console.error('UTF-8 validation failed:');
  for (const error of errors) {
    console.error(`- ${error.file}: ${error.reason}`);
  }
  process.exit(1);
}

console.log(`UTF-8 validation passed (${checked} files checked).`);
