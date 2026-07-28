import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);
const DEFAULT_LINE_LIMIT = 500;

const filesUnder = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? filesUnder(join(directory, entry.name))
    : [join(directory, entry.name)]);

const lineCount = file => readFileSync(file, 'utf8').split('\n').length;

export const analyzeProductionFileLines = (
  directories = ['frontend', 'dx/ollama-runner'],
  lineLimit = DEFAULT_LINE_LIMIT,
) => {
  const files = directories.flatMap(directory => filesUnder(resolve(directory)))
    .filter(file => SOURCE_EXTENSIONS.has(extname(file)))
    .filter(file => !file.includes(`${join('frontend', 'dist')}${String.raw`/`}`))
    .map(file => ({ file: relative(process.cwd(), file), lines: lineCount(file) }))
    .sort((left, right) => right.lines - left.lines);
  return {
    files,
    lineLimit,
    violations: files.filter(file => file.lines > lineLimit),
  };
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const lineLimit = Number(process.env.PRODUCTION_FILE_LINE_LIMIT ?? DEFAULT_LINE_LIMIT);
  const analysis = analyzeProductionFileLines(undefined, lineLimit);
  console.log(`production files: ${analysis.files.length}, limit ${lineLimit} LOC`);
  analysis.files.slice(0, 8)
    .forEach(file => console.log(`  ${file.lines.toString().padStart(4)}  ${file.file}`));
  analysis.violations.forEach(file =>
    console.error(`ERROR production file exceeds ${lineLimit} LOC: ${file.file} (${file.lines})`));
  if (analysis.violations.length) process.exitCode = 1;
}
