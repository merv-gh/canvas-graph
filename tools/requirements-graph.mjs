#!/usr/bin/env node

import { access, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CARD_W = 360;
const NODE_GAP_X = 28;
const NODE_GAP_Y = 24;
const CONTAINER_PAD_X = 36;
const SECTION_HEAD = 38;
const SECTION_PAD_Y = 26;
const SECTION_FOOT = 22;
const MAP_COLUMNS = 3;
const OVERVIEW_GAP_X = 210;
const OVERVIEW_GAP_Y = 92;

const cells = line => line.split('|').slice(1, -1).map(cell => cell.trim());
const plain = value => value
  .replace(/\*\*/g, '')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .trim();
const paragraph = value => value.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();

const sectionText = (markdown, heading) => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  return paragraph(match?.[1] ?? '');
};

/** Size cards from the text they must actually show. This mirrors the app's
 * text-layout contract closely enough that generated cards never depend on
 * overflow clipping for ordinary requirement prose. */
const cardSize = (title, description, width = CARD_W, minHeight = 116) => {
  const chars = Math.max(12, Math.floor((width - 32) / 7.2));
  const lines = text => String(text).split(/\r?\n/)
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / chars)), 0);
  return {
    w: width,
    h: Math.max(minHeight, lines(title) * 22 + lines(description) * 16 + 28),
  };
};

/** Parse the canonical requirement tables plus the human context needed by the
 * visual contract. Parsing is independent of heading order, but validation is
 * deliberately strict: the generated graph must never conceal a broken model. */
export function parseRequirements(markdown) {
  const attributes = [];
  const components = [];
  const capabilities = [];
  const blockers = [];
  const evidence = [];

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const row = cells(line);
    if (/^A\d{2}$/.test(row[0] ?? '')) {
      attributes.push({ id: row[0], name: plain(row[1] ?? ''), meaning: plain(row[2] ?? '') });
      continue;
    }
    if (/^C\d{2}$/.test(row[0] ?? '')) {
      components.push({ id: row[0], name: plain(row[1] ?? ''), boundary: plain(row[2] ?? '') });
      continue;
    }
    if (/^CAP-C\d{2}-A\d{2}-\d{2}$/.test(row[0] ?? '')) {
      const match = row[0].match(/^CAP-(C\d{2})-(A\d{2})-(\d{2})$/);
      capabilities.push({
        id: row[0],
        componentId: match[1],
        attributeId: match[2],
        release: plain(row[2] ?? ''),
        text: plain(row[3] ?? ''),
      });
      continue;
    }
    if (/^EVD-\d{3}$/.test(row[0] ?? '')) {
      evidence.push({
        id: row[0],
        capabilityId: plain(row[1] ?? ''),
        kind: plain(row[2] ?? '').toLowerCase(),
        state: plain(row[3] ?? '').toLowerCase(),
        proof: plain(row[4] ?? ''),
        acceptedOn: plain(row[5] ?? ''),
        notes: plain(row[6] ?? ''),
      });
      continue;
    }
    // The open ledger has five columns. Resolved-history rows have only two,
    // so they cannot be mistaken for current blockers.
    if (/^BR-\d{3}$/.test(row[0] ?? '') && row.length >= 5) {
      blockers.push({
        id: row[0],
        kind: plain(row[1] ?? ''),
        capabilityIds: (row[2]?.match(/CAP-C\d{2}-A\d{2}-\d{2}/g) ?? []),
        condition: plain(row[3] ?? ''),
        exit: plain(row[4] ?? ''),
      });
    }
  }

  const unique = (items, kind) => {
    const ids = items.map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${kind} id in requirements.md`);
  };
  unique(attributes, 'Attribute');
  unique(components, 'Component');
  unique(capabilities, 'Capability');
  unique(blockers, 'Blocker');
  unique(evidence, 'Evidence');
  if (!attributes.length || !components.length || !capabilities.length) {
    throw new Error('requirements.md must contain Attribute, Component, and Capability rows');
  }
  if (attributes.length > 12) throw new Error(`Attribute limit exceeded: ${attributes.length}/12`);
  if (components.length > 20) throw new Error(`Component limit exceeded: ${components.length}/20`);

  const attributeIds = new Set(attributes.map(attribute => attribute.id));
  const componentIds = new Set(components.map(component => component.id));
  const capabilityIds = new Set(capabilities.map(capability => capability.id));
  for (const capability of capabilities) {
    if (!attributeIds.has(capability.attributeId)) throw new Error(`${capability.id} references missing ${capability.attributeId}`);
    if (!componentIds.has(capability.componentId)) throw new Error(`${capability.id} references missing ${capability.componentId}`);
    if (!capability.text) throw new Error(`${capability.id} has no capability sentence`);
  }
  blockers.forEach(blocker => blocker.capabilityIds.forEach(id => {
    if (!capabilityIds.has(id)) throw new Error(`${blocker.id} references missing ${id}`);
  }));
  const evidenceKinds = new Set(['automated', 'manual', 'decision', 'release']);
  const evidenceStates = new Set(['accepted', 'pending', 'rejected', 'stale']);
  evidence.forEach(record => {
    if (!capabilityIds.has(record.capabilityId)) throw new Error(`${record.id} references missing ${record.capabilityId}`);
    if (!evidenceKinds.has(record.kind)) throw new Error(`${record.id} has unsupported evidence kind “${record.kind}”`);
    if (!evidenceStates.has(record.state)) throw new Error(`${record.id} has unsupported evidence state “${record.state}”`);
    const hasProof = !!record.proof && record.proof !== '—';
    const hasAcceptedDate = /^\d{4}-\d{2}-\d{2}$/.test(record.acceptedOn);
    if (record.state === 'accepted' && !hasProof) throw new Error(`${record.id} is accepted without a proof locator`);
    if (record.state === 'accepted' && !hasAcceptedDate) throw new Error(`${record.id} is accepted without a YYYY-MM-DD acceptance date`);
    if (record.acceptedOn && record.acceptedOn !== '—' && !hasAcceptedDate) {
      throw new Error(`${record.id} has an invalid acceptance date`);
    }
    if (record.kind === 'automated' && hasProof && !/^[^#]+#.+/.test(record.proof)) {
      throw new Error(`${record.id} automated proof must be path#assertion`);
    }
  });

  return {
    title: markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Product requirements',
    status: markdown.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1]?.trim() ?? 'Unknown',
    baselineDate: markdown.match(/^\*\*Baseline date:\*\*\s*(.+)$/m)?.[1]?.trim() ?? '',
    mission: sectionText(markdown, 'Mission'),
    attributes,
    components,
    capabilities,
    blockers,
    evidence,
  };
}

/** Accepted automated evidence must point at a real repository file and name
 * the exact assertion after `#`. The Markdown parser validates semantics; this
 * filesystem pass prevents a convincing but dead proof link. */
export async function validateEvidenceLocators(model, repoRoot) {
  for (const record of model.evidence) {
    if (record.kind !== 'automated' || record.state !== 'accepted') continue;
    const [path, assertion] = record.proof.split('#', 2);
    if (!path?.startsWith('tests/') || !assertion?.trim()) {
      throw new Error(`${record.id} automated proof must identify tests/...#assertion`);
    }
    try {
      await access(resolve(repoRoot, path));
    } catch {
      throw new Error(`${record.id} references missing proof file ${path}`);
    }
  }
}

const blockersByCapability = model => {
  const byCapability = new Map();
  model.blockers.forEach(blocker => blocker.capabilityIds.forEach(id => {
    const current = byCapability.get(id) ?? [];
    current.push(blocker);
    byCapability.set(id, current);
  }));
  return byCapability;
};

const evidenceByCapability = model => {
  const byCapability = new Map();
  model.evidence.forEach(record => {
    const current = byCapability.get(record.capabilityId) ?? [];
    current.push(record);
    byCapability.set(record.capabilityId, current);
  });
  return byCapability;
};

const evidenceStateOf = (capability, records) => {
  if (capability.release !== '0.1') return 'not-required';
  if (records.some(record => record.state === 'accepted')) return 'accepted';
  if (!records.length) return 'missing';
  return ['rejected', 'stale', 'pending'].find(state => records.some(record => record.state === state)) ?? 'missing';
};

const evidenceCoverageOf = model => {
  const byCapability = evidenceByCapability(model);
  const release = model.capabilities.filter(capability => capability.release === '0.1');
  const states = release.map(capability => evidenceStateOf(capability, byCapability.get(capability.id) ?? []));
  const count = state => states.filter(candidate => candidate === state).length;
  const accepted = count('accepted');
  return {
    status: accepted === release.length ? 'complete' : model.evidence.length ? 'partial' : 'not-modeled',
    accepted,
    required: release.length,
    unproven: release.length - accepted,
    missing: count('missing'),
    pending: count('pending'),
    rejected: count('rejected'),
    stale: count('stale'),
    records: model.evidence.length,
  };
};

const groupPlan = items => {
  const rows = [];
  for (let index = 0; index < items.length; index += MAP_COLUMNS) rows.push(items.slice(index, index + MAP_COLUMNS));
  const placements = [];
  let cursor = SECTION_HEAD + SECTION_PAD_Y;
  rows.forEach(row => {
    const height = Math.max(...row.map(item => item.size.h));
    row.forEach((item, column) => placements.push({
      item,
      x: CONTAINER_PAD_X + item.size.w / 2 + column * (CARD_W + NODE_GAP_X),
      y: cursor + height / 2,
    }));
    cursor += height + NODE_GAP_Y;
  });
  return {
    placements,
    height: cursor - NODE_GAP_Y + SECTION_FOOT,
  };
};

const attributePlan = (attribute, components, capabilities, blockerMap, evidenceMap) => {
  const groups = [{
    id: 'definition',
    title: 'Attribute definition',
    items: [{
      kind: 'definition',
      text: attribute.meaning,
      size: cardSize(`${attribute.id} · ${attribute.name}`, attribute.meaning),
    }],
  }];
  for (const component of components) {
    const items = capabilities.filter(capability => capability.componentId === component.id).map(capability => {
      const open = blockerMap.get(capability.id) ?? [];
      const records = evidenceMap.get(capability.id) ?? [];
      const evidenceState = evidenceStateOf(capability, records);
      const acceptedEvidenceIds = records.filter(record => record.state === 'accepted').map(record => record.id);
      const evidenceText = evidenceState === 'not-required'
        ? 'Evidence: not required for 0.1'
        : evidenceState === 'accepted'
          ? `Evidence: accepted · ${acceptedEvidenceIds.join(', ')}`
          : records.length
            ? `Evidence: ${evidenceState} · ${records.map(record => record.id).join(', ')}`
            : 'Evidence: missing · no accepted proof record';
      const blockerText = open.flatMap(blocker => [
        `Open blocker: ${blocker.id} · ${blocker.kind}`,
        `Condition: ${blocker.condition}`,
        `Exit: ${blocker.exit}`,
      ]).join('\n');
      const description = [component.name, capability.text, evidenceText, blockerText].filter(Boolean).join('\n');
      return {
        ...capability,
        kind: 'capability',
        description,
        blockers: open.map(blocker => blocker.id),
        evidenceState,
        evidenceIds: records.map(record => record.id),
        acceptedEvidenceIds,
        size: cardSize(`${capability.id} · ${capability.release}`, description),
      };
    });
    if (items.length) groups.push({ id: component.id.toLowerCase(), title: `${component.id} · ${component.name}`, items });
  }
  const plannedGroups = groups.map(group => ({ ...group, ...groupPlan(group.items) }));
  return {
    attribute,
    groups: plannedGroups,
    width: CONTAINER_PAD_X * 2 + CARD_W * MAP_COLUMNS + NODE_GAP_X * (MAP_COLUMNS - 1),
    height: plannedGroups.reduce((total, group) => total + group.height, 0),
  };
};

/** Convert the parsed model into a schema-v1 Canvas Graph snapshot. The first
 * frame is a readable contract index: one open root, one mission card, and nine
 * folded Attribute containers. Opening an Attribute reveals its Component
 * sections and every capability without changing the source Markdown. */
export function buildRequirementsGraph(model, source = 'requirements/requirements.md') {
  const components = new Map(model.components.map(component => [component.id, component]));
  const blockerMap = blockersByCapability(model);
  const evidenceMap = evidenceByCapability(model);
  const evidenceCoverage = evidenceCoverageOf(model);
  const plans = model.attributes.map(attribute => attributePlan(
    attribute,
    model.components,
    model.capabilities.filter(capability => capability.attributeId === attribute.id),
    blockerMap,
    evidenceMap,
  ));
  const nodes = [];
  const containers = [];
  const capabilityNodes = {};
  const capabilityIndex = {};
  let nextNode = 1;

  const missionId = 'requirements-mission';
  const missionDescription = [
    model.mission,
    `Contract status: ${model.status}${model.baselineDate ? ` · baseline ${model.baselineDate}` : ''}`,
    `Source: ${source} · regenerate with npm run requirements:graph`,
    `Legend: square = 0.1; circle = Later; “Open blocker” is unresolved release work.`,
    `Evidence: ${evidenceCoverage.accepted}/${evidenceCoverage.required} release Capabilities have accepted proof; ${evidenceCoverage.unproven} remain unproven (${evidenceCoverage.missing} missing, ${evidenceCoverage.pending} pending, ${evidenceCoverage.rejected} rejected, ${evidenceCoverage.stale} stale; ${evidenceCoverage.records} records).`,
  ].join('\n');
  const missionSize = cardSize('Mission · Requirements contract', missionDescription, 900, 190);
  nodes.push({
    id: missionId,
    Label: { text: 'Mission · Requirements contract' },
    Description: missionDescription,
    Position: { x: 0, y: -160 },
    Size: missionSize,
    NodeType: 'text',
  });

  const attributeContainers = [];
  plans.forEach((plan, index) => {
    const column = index % MAP_COLUMNS;
    const row = Math.floor(index / MAP_COLUMNS);
    const center = {
      x: (column - 1) * OVERVIEW_GAP_X,
      y: 70 + row * OVERVIEW_GAP_Y,
    };
    const left = center.x - plan.width / 2;
    const top = center.y - plan.height / 2;
    const children = [];
    const childSections = {};
    const sections = [];
    const capabilityIds = [];
    let bandTop = top;

    plan.groups.forEach(group => {
      sections.push({ id: group.id, title: group.title, weight: group.height });
      group.placements.forEach(({ item, x, y }) => {
        const id = `e${nextNode++}`;
        const isDefinition = item.kind === 'definition';
        const component = isDefinition ? null : components.get(item.componentId);
        nodes.push({
          id,
          Label: { text: isDefinition ? `${plan.attribute.id} · ${plan.attribute.name}` : `${item.id} · ${item.release}` },
          Description: isDefinition ? item.text : item.description ?? `${component?.name ?? item.componentId}\n${item.text}`,
          Position: { x: left + x, y: bandTop + y },
          Size: item.size,
          NodeType: isDefinition ? 'text' : item.release === '0.1' ? 'square' : 'circle',
        });
        if (!isDefinition) {
          capabilityIds.push(item.id);
          capabilityNodes[item.id] = id;
          capabilityIndex[item.id] = {
            nodeId: id,
            attributeId: plan.attribute.id,
            componentId: item.componentId,
            componentName: component?.name ?? item.componentId,
            release: item.release,
            blockerIds: item.blockers,
            evidenceIds: item.evidenceIds,
            acceptedEvidenceIds: item.acceptedEvidenceIds,
            evidenceState: item.evidenceState,
          };
        }
        children.push({ kind: 'node', id });
        childSections[`node:${id}`] = group.id;
      });
      bandTop += group.height;
    });

    const containerId = `c${index + 1}`;
    containers.push({
      id: containerId,
      Label: { text: `${plan.attribute.id} · ${plan.attribute.name}` },
      Position: center,
      Size: { w: plan.width, h: plan.height },
      AutoFit: false,
      Sections: sections,
      SectionAxis: 'rows',
      ChildSections: childSections,
      Children: children,
    });
    attributeContainers.push({
      id: plan.attribute.id,
      name: plan.attribute.name,
      containerId,
      capabilityIds,
    });
  });

  const rootContainerId = 'c0';
  containers.unshift({
    id: rootContainerId,
    Label: { text: `Requirements · ${model.capabilities.length} capabilities` },
    Position: { x: 0, y: 60 },
    Size: { w: 900, h: 620 },
    AutoFit: true,
    Sections: [],
    SectionAxis: 'rows',
    ChildSections: {},
    Children: [
      { kind: 'node', id: missionId },
      ...attributeContainers.map(attribute => ({ kind: 'container', id: attribute.containerId })),
    ],
  });

  return {
    schemaVersion: 1,
    name: 'Requirements map',
    nodes,
    edges: [],
    extensions: {
      containers,
      requirementsMap: {
        version: 3,
        source,
        sourceMode: 'generated-projection',
        regenerateCommand: 'npm run requirements:graph',
        encoding: 'Open root → folded Attribute containers → Component sections → Capability nodes',
        legend: 'Square = 0.1; circle = Later; definition card = Attribute meaning; blocker text = unresolved release work',
        rootContainerId,
        missionNodeId: missionId,
        attributeContainers,
        components: model.components.map(component => ({ id: component.id, name: component.name })),
        capabilityNodes,
        capabilities: capabilityIndex,
        defaultFoldedContainerIds: attributeContainers.map(attribute => attribute.containerId),
        counts: {
          attributes: model.attributes.length,
          components: model.components.length,
          capabilities: model.capabilities.length,
          releaseCapabilities: model.capabilities.filter(capability => capability.release === '0.1').length,
          openBlockers: model.blockers.length,
          evidenceRecords: model.evidence.length,
        },
        evidenceCoverage,
        evidenceRecords: model.evidence,
        openBlockers: model.blockers,
      },
    },
  };
}

export async function generateRequirementsGraph(inputPath, outputPath) {
  const markdown = await readFile(inputPath, 'utf8');
  const model = parseRequirements(markdown);
  await validateEvidenceLocators(model, resolve(dirname(inputPath), '..'));
  const source = inputPath.endsWith('requirements.md') ? 'requirements/requirements.md' : inputPath;
  const graph = buildRequirementsGraph(model, source);
  await writeFile(outputPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  return { model, graph };
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const root = resolve(dirname(thisFile), '..');
  const input = resolve(process.cwd(), process.argv[2] ?? resolve(root, 'requirements/requirements.md'));
  const output = resolve(process.cwd(), process.argv[3] ?? resolve(root, 'requirements/requirements.graph.json'));
  const { model, graph } = await generateRequirementsGraph(input, output);
  console.log(`Generated ${output}`);
  console.log(`${model.capabilities.length} capabilities in ${graph.extensions.containers.length - 1} Attribute containers, ${model.components.length} Component definitions, and one mission root.`);
  console.log(`${model.blockers.length} open blockers are linked to their Capability cards.`);
  const coverage = graph.extensions.requirementsMap.evidenceCoverage;
  console.log(`${coverage.accepted}/${coverage.required} release Capabilities have accepted evidence from ${coverage.records} ledger records.`);
}
