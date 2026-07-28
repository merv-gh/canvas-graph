import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_EXTENSIONS = new Set(['.js', '.ts', '.cjs', '.mjs']);
const DEFAULT_WARNING_LINES = 1_000;

const filesUnder = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? filesUnder(join(directory, entry.name))
    : [join(directory, entry.name)]);

const lineCount = file => readFileSync(file, 'utf8').split('\n').length;

export const analyzeTestFileLines = (directory, warningLines = DEFAULT_WARNING_LINES) => {
  const root = resolve(directory);
  const files = filesUnder(root)
    .filter(file => TEST_EXTENSIONS.has(extname(file)))
    .map(file => ({ file: relative(process.cwd(), file), lines: lineCount(file) }))
    .sort((left, right) => right.lines - left.lines);
  return {
    files,
    totalLines: files.reduce((sum, file) => sum + file.lines, 0),
    warnings: files.filter(file => file.lines > warningLines),
    warningLines,
  };
};

const report = ({ files, totalLines, warnings, warningLines }) => {
  console.log(`test files: ${files.length} files, ${totalLines.toLocaleString()} LOC, warning > ${warningLines} LOC`);
  files.slice(0, 5).forEach(file => console.log(`  ${file.lines.toString().padStart(4)}  ${file.file}`));
  warnings.forEach(file => console.warn(`WARN test file exceeds ${warningLines} LOC: ${file.file} (${file.lines})`));
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const warningLines = Number(
    process.env.TEST_FILE_LINE_WARNING ?? process.env.TEST_FILE_LOC_WARN ?? DEFAULT_WARNING_LINES,
  );
  const analysis = analyzeTestFileLines(process.argv[2] ?? 'tests', warningLines);
  report(analysis);
  const enforce = process.env.TEST_FILE_LINE_ENFORCE ?? process.env.TEST_FILE_LOC_ENFORCE;
  if (analysis.warnings.length && enforce === '1') process.exitCode = 1;
}
