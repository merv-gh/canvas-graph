import type { Graph } from './model';
import type { Id } from './types';

export type RequirementsAttributeMap = {
  id: string;
  name: string;
  containerId: Id;
  capabilityIds: string[];
};

export type RequirementsBlocker = {
  id: string;
  kind: string;
  capabilityIds: string[];
  condition: string;
  exit: string;
};

export type RequirementsEvidenceState = 'accepted' | 'missing' | 'pending' | 'rejected' | 'stale' | 'not-required';

export type RequirementsEvidenceRecord = {
  id: string;
  capabilityId: string;
  kind: 'automated' | 'manual' | 'decision' | 'release' | string;
  state: 'accepted' | 'pending' | 'rejected' | 'stale' | string;
  proof: string;
  acceptedOn: string;
  notes: string;
};

export type RequirementsCapabilityMap = {
  nodeId: Id;
  attributeId: string;
  componentId: string;
  componentName: string;
  release: string;
  blockerIds: string[];
  evidenceIds: string[];
  acceptedEvidenceIds: string[];
  evidenceState: RequirementsEvidenceState;
};

export type RequirementsFilterKey = 'scope' | 'readiness' | 'attribute' | 'component';
export type RequirementsReviewFilters = Record<RequirementsFilterKey, string>;

export const emptyRequirementsFilters = (): RequirementsReviewFilters => ({
  scope: 'all', readiness: 'all', attribute: 'all', component: 'all',
});

export const requirementsFiltersActive = (filters: RequirementsReviewFilters) =>
  Object.values(filters).some(value => value !== 'all');

export const requirementsCapabilityPasses = (
  capability: RequirementsCapabilityMap,
  filters: RequirementsReviewFilters,
) => {
  if (filters.scope === '0.1' && capability.release !== '0.1') return false;
  if (filters.scope === 'later' && capability.release === '0.1') return false;
  if (filters.attribute !== 'all' && capability.attributeId !== filters.attribute) return false;
  if (filters.component !== 'all' && capability.componentId !== filters.component) return false;
  switch (filters.readiness) {
    case 'blocked': return capability.blockerIds.length > 0;
    case 'needs-proof': return capability.release === '0.1' && capability.evidenceState !== 'accepted';
    case 'missing': return capability.evidenceState === 'missing';
    case 'pending': return ['pending', 'rejected', 'stale'].includes(capability.evidenceState);
    case 'proven': return capability.evidenceState === 'accepted';
    default: return true;
  }
};

export type RequirementsMapMetadata = {
  version: number;
  source: string;
  sourceMode: 'generated-projection' | string;
  regenerateCommand: string;
  encoding: string;
  legend: string;
  rootContainerId: Id;
  missionNodeId: Id;
  attributeContainers: RequirementsAttributeMap[];
  components?: Array<{ id: string; name: string }>;
  capabilityNodes: Record<string, Id>;
  capabilities?: Record<string, RequirementsCapabilityMap>;
  defaultFoldedContainerIds: Id[];
  counts: { attributes: number; components: number; capabilities: number; releaseCapabilities: number; openBlockers: number; evidenceRecords?: number };
  evidenceCoverage: {
    status: string;
    accepted: number;
    required: number;
    unproven?: number;
    missing?: number;
    pending?: number;
    rejected?: number;
    stale?: number;
    records?: number;
  };
  evidenceRecords?: RequirementsEvidenceRecord[];
  openBlockers: RequirementsBlocker[];
};

export const requirementsMapOf = (graph: Graph): RequirementsMapMetadata | null => {
  const value = graph.snapshotExtension<RequirementsMapMetadata>('requirementsMap');
  if (!value || value.version < 2 || !value.rootContainerId || !Array.isArray(value.attributeContainers)) return null;
  return value;
};
