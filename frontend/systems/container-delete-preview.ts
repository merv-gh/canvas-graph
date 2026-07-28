import type { Id } from '../types';
import type { Container } from './container-entity';

export const createContainerDeletePreview = (
  containersHere: () => Map<Id, Container>,
) => {
    const counts = (id: Id) => {
      const seen = new Set<Id>();
      let nodes = 0;
      let containers = 0;
      const visit = (containerId: Id) => {
        if (seen.has(containerId)) return;
        seen.add(containerId);
        containersHere().get(containerId)?.Children.forEach(child => {
          if (child.kind === 'node') nodes += 1;
          else if (child.kind === 'container') { containers += 1; visit(child.id); }
        });
      };
      visit(id);
      return { nodes, containers };
    };
    const body = (id: Id) => () => {
      const container = containersHere().get(id);
      const descendants = counts(id);
      const panel = document.createElement('section');
      panel.className = 'delete-preview container-delete-preview';
      const warning = document.createElement('p');
      const parts = [
        descendants.nodes ? `${descendants.nodes} node${descendants.nodes === 1 ? '' : 's'}` : '',
        descendants.containers ? `${descendants.containers} nested container${descendants.containers === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      warning.textContent = parts.length
        ? `Delete “${container?.Label.text ?? id}” and its ${parts.join(' and ')}? This cannot be undone.`
        : `Delete empty container “${container?.Label.text ?? id}”?`;
      const note = document.createElement('small');
      note.textContent = parts.length ? 'To remove only the boundary, choose Ungroup and keep contents.' : '';
      const actions = document.createElement('div');
      actions.className = 'import-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.dataset.command = 'container.delete.cancel';
      cancel.dataset.containerDeleteCancel = '';
      cancel.textContent = 'Keep container';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'danger graph-delete-confirm';
      confirm.dataset.command = 'container.delete.confirm';
      confirm.dataset.containerDeleteConfirm = '';
      confirm.textContent = parts.length ? 'Delete contents' : 'Delete container';
      actions.append(cancel, confirm);
      panel.append(warning);
      if (note.textContent) panel.append(note);
      panel.append(actions);
      return panel;
    };
    return { body, counts };
};
