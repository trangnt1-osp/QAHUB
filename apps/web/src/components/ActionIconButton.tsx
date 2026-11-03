import { Button, Tooltip, type ButtonProps } from 'antd';
import { forwardRef, useState, type ReactNode } from 'react';

type Props = Omit<ButtonProps, 'children' | 'type' | 'size' | 'href'> & { label: string; icon: ReactNode };

/** Consistent row actions with accessible labels and hover/keyboard tooltips. */
export const ActionIconButton = forwardRef<HTMLAnchorElement | HTMLButtonElement, Props>(function ActionIconButton(
  { label, icon, onClick, ...props }, ref,
) {
  const [open, setOpen] = useState(false);
  return <Tooltip title={label} trigger={['hover', 'focus']} open={open} onOpenChange={setOpen}
    styles={{ root: { pointerEvents: 'none' } }}>
    <Button {...props} ref={ref} type="text" size="small" aria-label={label} icon={icon}
      onClick={(event) => { event.stopPropagation(); setOpen(false); onClick?.(event); }} />
  </Tooltip>;
});
