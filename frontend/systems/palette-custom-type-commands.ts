import {
  isNodeColor,
  isNodeFill,
  NODE_COLORS,
  NODE_FILLS,
  type GraphNode,
  type NodeBorder,
  type NodeColor,
  type NodeFill,
  type NodeType,
} from '../model';
import type { CommandSpecInput } from '../types';

type ActivePaletteStyle = {
  border?: NodeBorder;
  color?: NodeColor;
  fill?: NodeFill;
  type: NodeType;
};

type CustomTypeCommandDependencies = {
  activeStyle: () => ActivePaletteStyle;
  presetId: () => string;
  selectedNode: () => GraphNode | undefined;
  typeForms: ReadonlyArray<{ value: NodeType; label: string }>;
};

const validateName = (label: string | undefined) => {
  if (!label?.trim()) return 'Give this type a name.';
  if (label.trim().length > 48) return 'Type names can be up to 48 characters.';
};

export const customPaletteTypeCommands = ({
  activeStyle,
  presetId,
  selectedNode,
  typeForms,
}: CustomTypeCommandDependencies): CommandSpecInput[] => [
  {
    id: 'palette.custom-type.create', label: 'Create custom palette type', event: 'preset.type.register',
    group: 'palette',
    form: {
      title: 'New palette type', submitLabel: 'Save and use', shouldOpen: () => true,
      fields: [
        { id: 'label', label: 'Type name', placeholder: 'Critical service', autofocus: true },
        { id: 'shape', label: 'Form', input: 'select', options: () => [...typeForms] },
        { id: 'color', label: 'Color', input: 'select', options: () => [
          { value: 'automatic', label: 'Automatic' }, ...NODE_COLORS,
        ] },
        { id: 'fill', label: 'Fill', input: 'select', options: () => NODE_FILLS },
        { id: 'border', label: 'Border', input: 'select', options: () => [
          { value: 'automatic', label: 'Match color' }, { value: 'none', label: 'None' }, ...NODE_COLORS,
        ] },
      ],
      seed: () => {
        const node = selectedNode();
        const style = activeStyle();
        const shape = node?.NodeType ?? style.type;
        return {
          label: node?.Label.text ?? '',
          shape: typeForms.some(option => option.value === shape) ? shape : 'rounded',
          color: node?.Color ?? style.color ?? 'automatic',
          fill: node?.Fill ?? style.fill ?? 'soft',
          border: node?.BorderColor ?? style.border ?? 'automatic',
        };
      },
      validate: values => {
        const nameError = validateName(values.label);
        if (nameError) return nameError;
        if (!typeForms.some(option => option.value === values.shape)) return 'Choose a valid form.';
        if (values.color !== 'automatic' && !isNodeColor(values.color)) return 'Choose a valid color.';
        if (!isNodeFill(values.fill)) return 'Choose a valid fill.';
        if (values.border !== 'automatic' && values.border !== 'none' && !isNodeColor(values.border)) {
          return 'Choose a valid border.';
        }
      },
      payload: values => {
        const label = values.label.trim();
        const slug = label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'type';
        return {
          preset: presetId(),
          entry: {
            id: `custom-${Date.now().toString(36)}-${slug}`,
            label,
            value: values.shape as NodeType,
            color: values.color === 'automatic' ? undefined : values.color as NodeColor,
            fill: values.fill as NodeFill,
            border: values.border === 'automatic' ? undefined : values.border as NodeBorder,
          },
        };
      },
    },
  },
  {
    id: 'palette.custom-type.rename', label: 'Rename custom palette type', event: 'preset.type.rename',
    group: 'palette', hidden: true,
    payload: ({ target }) => {
      const control = target?.closest<HTMLElement>('[data-custom-type-id]');
      return {
        preset: control?.dataset.customTypePreset ?? '',
        entryId: control?.dataset.customTypeId ?? '',
        label: control?.dataset.customTypeLabel ?? '',
      };
    },
    form: {
      title: 'Rename palette type', submitLabel: 'Rename',
      shouldOpen: payload => !!(payload as { entryId?: string } | undefined)?.entryId,
      fields: [
        { id: 'preset', label: '', input: 'hidden' },
        { id: 'entryId', label: '', input: 'hidden' },
        { id: 'label', label: 'Type name', autofocus: true },
      ],
      seed: payload => payload as Record<string, string>,
      validate: values => validateName(values.label),
      payload: values => ({
        preset: values.preset,
        entryId: values.entryId,
        label: values.label.trim(),
      }),
    },
  },
  {
    id: 'palette.custom-type.delete.request', label: 'Delete custom palette type',
    group: 'palette', hidden: true,
    payload: ({ target }) => {
      const control = target?.closest<HTMLElement>('[data-custom-type-id]');
      return { preset: control?.dataset.customTypePreset ?? '', entryId: control?.dataset.customTypeId ?? '' };
    },
  },
  {
    id: 'palette.custom-type.delete.confirm', label: 'Confirm custom palette type deletion',
    group: 'palette', hidden: true,
  },
];
