import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const budgets = {
  appTotal: 550 * KB,
  appJs: 410 * KB,
  appJsGzip: 130 * KB,
  appCss: 132 * KB,
  appCssGzip: 24 * KB,
  libraryJs: 560 * KB,
  libraryJsGzip: 160 * KB,
  libraryTotal: 570 * KB,
};

const filesUnder = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? filesUnder(join(directory, entry.name))
    : [join(directory, entry.name)]);

const bytes = file => statSync(file).size;
const gzipBytes = file => gzipSync(readFileSync(file), { level: 9 }).byteLength;
const only = (files, test, label) => {
  const matches = files.filter(test);
  if (matches.length !== 1) throw new Error(`Expected one ${label}; found ${matches.length}`);
  return matches[0];
};
const total = files => files.reduce((sum, file) => sum + bytes(file), 0);
const kb = value => `${(value / KB).toFixed(1)} KB`;

export const analyzeBuildArtifactSizes = (
  appDirectory = resolve('frontend/dist'),
  libraryDirectory = resolve('dist-lib'),
) => {
  const appFiles = filesUnder(appDirectory);
  const libraryFiles = filesUnder(libraryDirectory);
  const appJs = only(appFiles, file => /\/assets\/index-[^/]+\.js$/.test(file), 'app entry JavaScript');
  const appCss = only(appFiles, file => /\/assets\/index-[^/]+\.css$/.test(file), 'app stylesheet');
  const libraryJs = only(libraryFiles, file => file.endsWith('/graph-viewer.js'), 'library JavaScript');
  const metrics = {
    appTotal: total(appFiles),
    appJs: bytes(appJs),
    appJsGzip: gzipBytes(appJs),
    appCss: bytes(appCss),
    appCssGzip: gzipBytes(appCss),
    libraryJs: bytes(libraryJs),
    libraryJsGzip: gzipBytes(libraryJs),
    libraryTotal: total(libraryFiles),
  };
  return {
    metrics,
    violations: Object.entries(metrics)
      .filter(([name, value]) => value > budgets[name])
      .map(([name, value]) => ({ name, value, budget: budgets[name] })),
  };
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { metrics, violations } = analyzeBuildArtifactSizes();
  console.log(`app: ${kb(metrics.appTotal)} total · JS ${kb(metrics.appJs)} / ${kb(metrics.appJsGzip)} gzip · CSS ${kb(metrics.appCss)} / ${kb(metrics.appCssGzip)} gzip`);
  console.log(`library: ${kb(metrics.libraryTotal)} total · JS ${kb(metrics.libraryJs)} / ${kb(metrics.libraryJsGzip)} gzip`);
  violations.forEach(({ name, value, budget }) =>
    console.error(`ERROR ${name} exceeds budget: ${kb(value)} > ${kb(budget)}`));
  if (violations.length) process.exitCode = 1;
}
