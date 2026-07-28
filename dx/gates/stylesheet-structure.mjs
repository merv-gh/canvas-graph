import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const selectorList = selector => {
  const selectors = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (character === ',' && depth === 0) {
      selectors.push(selector.slice(start, index).trim().replace(/\s+/g, ' '));
      start = index + 1;
    }
  }
  selectors.push(selector.slice(start).trim().replace(/\s+/g, ' '));
  return selectors;
};

const contextOf = rule => {
  const context = [];
  for (let parent = rule.parent; parent?.type === 'atrule'; parent = parent.parent) {
    context.unshift(`@${parent.name} ${parent.params}`);
  }
  return context.join(' > ') || 'root';
};

const declarationSignature = rule => rule.nodes
  .filter(node => node.type === 'decl')
  .map(declaration => `${declaration.prop}:${declaration.value}${declaration.important ? '!important' : ''}`)
  .join(';');

export const analyzeStylesheet = source => {
  const root = postcss.parse(source);
  const rules = [];
  const scaleViolations = { elevation: [], radius: [], spacing: [], typography: [] };
  let declarations = 0;
  root.walkDecls(declaration => {
    if (declaration.prop.startsWith('--')) return;
    const violation = {
      line: declaration.source?.start?.line ?? 0,
      property: declaration.prop,
      value: declaration.value,
    };
    if ((/^(?:margin|padding)(?:-|$)/.test(declaration.prop)
      || /^(?:gap|row-gap|column-gap|scroll-padding(?:-|$))$/.test(declaration.prop))
      && /\dpx\b/.test(declaration.value)) scaleViolations.spacing.push(violation);
    if (/radius$/.test(declaration.prop) && /\dpx\b/.test(declaration.value)) {
      scaleViolations.radius.push(violation);
    }
    if ((declaration.prop === 'font' || declaration.prop === 'font-size')
      && /\dpx\b/.test(declaration.value)) scaleViolations.typography.push(violation);
    if (declaration.prop === 'box-shadow'
      && declaration.value !== 'none'
      && !declaration.value.startsWith('var(')
      && !declaration.value.startsWith('inset ')) scaleViolations.elevation.push(violation);
  });
  root.walkRules(rule => {
    const signature = declarationSignature(rule);
    declarations += rule.nodes.filter(node => node.type === 'decl').length;
    if (signature) rules.push({
      context: contextOf(rule),
      line: rule.source?.start?.line ?? 0,
      selector: rule.selector,
      selectors: selectorList(rule.selector),
      signature,
    });
  });

  const repeatedBlocks = new Map();
  rules.forEach(rule => {
    const key = `${rule.context}\n${rule.signature}`;
    const group = repeatedBlocks.get(key) ?? [];
    group.push({ line: rule.line, selector: rule.selector });
    repeatedBlocks.set(key, group);
  });

  return {
    bytes: Buffer.byteLength(source),
    declarations,
    duplicateRuleGroups: [...repeatedBlocks.values()].filter(group => group.length > 1),
    lines: source.split('\n').length,
    rules: rules.length,
    scaleViolations,
  };
};

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const path = resolve(process.argv[2] ?? 'frontend/styles.css');
  const structure = analyzeStylesheet(readFileSync(path, 'utf8'));
  console.log(JSON.stringify({ path, ...structure }, null, 2));
}
