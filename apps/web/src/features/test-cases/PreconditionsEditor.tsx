import { preconditionsDocument, serializePreconditions, type PreconditionsDocument } from '@ospm/shared';
import { RichTextEditor } from '../../components/RichTextEditor';

/** Keep the existing text API compatible while preserving the editor document for formatted content. */
export function PreconditionsEditor({ value, onChange, disabled = false }: { value?: string | null; onChange?: (value: string) => void; disabled?: boolean }) {
  return <div aria-label="Pre-conditions"><RichTextEditor value={preconditionsDocument(value)} editable={!disabled} placeholder="Nhập điều kiện tiên quyết…" onChange={doc => onChange?.(serializePreconditions(doc as PreconditionsDocument))} /></div>;
}
