import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

type Props = {
  title: string;
  onClose: () => void;
  left?: ComponentChildren;
  right?: ComponentChildren;
  footer?: ComponentChildren;
  children: ComponentChildren;
  variant?: 'surface' | 'detail';
  side?: boolean;
  label?: string;
};

/** Bottom sheet on phones; a side sheet on desktop when `side` is set. */
export function Sheet({ title, onClose, left, right, footer, children, variant = 'surface', side = false, label }: Props) {
  useEffect(() => {
    document.body.classList.add('locked');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <>
      <div class="scrim" onClick={onClose} />
      <div class={`sheet ${variant === 'detail' ? 'detail' : ''} ${side ? 'side' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? title}>
        <div class="sheet-head">
          <div class="left">{left ?? <button onClick={onClose}>Close</button>}</div>
          <div class="title">{title}</div>
          <div class="right">{right}</div>
        </div>
        <div class="sheet-body">{children}</div>
        {footer ? <div class="sheet-foot">{footer}</div> : null}
      </div>
    </>
  );
}
