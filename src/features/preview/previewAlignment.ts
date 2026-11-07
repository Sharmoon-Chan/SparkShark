import type { FieldAlignmentState, PreviewFieldAlignment } from '../../domain/types';

export interface PreviewAlignmentActions {
  read: (sectionId: string, fieldKey: string) => FieldAlignmentState;
  apply: (change: PreviewFieldAlignment) => void;
}
