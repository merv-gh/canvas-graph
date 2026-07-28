import type { SystemCtx } from '../core';

type PaletteSurfaceDependencies = {
  contribute: SystemCtx['contribute'];
  contexts: SystemCtx['contexts'];
  emit: SystemCtx['emit'];
  isMobileOpen: () => boolean;
  isPlacing: () => boolean;
  isText: () => boolean;
  origin: string;
  setMobileOpen: (open: boolean) => void;
};

export const registerPaletteSurface = ({
  contribute,
  contexts,
  emit,
  isMobileOpen,
  isPlacing,
  isText,
  origin,
  setMobileOpen,
}: PaletteSurfaceDependencies) => {
    contexts.interaction.cancel.register({
      origin,
      priority: 20,
      background: false,
      blocksPointer: true,
      active: isPlacing,
      cancel: () => emit('palette.place.cancel'),
    });
    contexts.interaction.cancel.register({
      origin: `${origin}.mobile`,
      priority: 40,
      background: false,
      active: isMobileOpen,
      cancel: () => setMobileOpen(false),
    });
    contexts.commands.register([{
      id: 'palette.mobile.tab', label: 'Keep focus in the mobile palette', group: 'palette', hidden: true,
      input: {
        on: 'keydown', key: 'Tab', global: true, prevent: true, stop: true,
        when: event => isMobileOpen() && globalThis.innerWidth <= 700
          && !!(event.target as Element | null)?.closest('.palette-sheet'),
      },
      payload: ({ event }) => ({ shift: (event as KeyboardEvent).shiftKey }),
    }]);
    contexts.storage.claimDefaults('node', origin);

    contribute({
      origin,
      surface: 'top',
      command: 'palette.arm.type.text',
      kind: 'button',
      icon: 'text',
      label: 'Text tool',
      className: 'canvas-type-tool palette-text-type',
      active: isText,
      slot: 'start',
      group: 'type',
      order: 2,
    });

    contribute({
      origin,
      surface: 'top',
      command: 'palette.place.activate',
      kind: 'button',
      icon: () => isText() ? 'text' : 'node',
      label: 'Add node',
      className: 'canvas-mode-tool palette-place-switch',
      active: isPlacing,
      slot: 'start',
      group: 'mode',
      order: 3,
    });


};
