import type { ReactNode } from 'react';

/**
 * A 9-slice panel: fixed-ratio cap, vertically tiling middle, fixed-ratio foot.
 * The 2010 artwork is the look; flattening it into a rounded rectangle is not
 * an acceptable substitute.
 */
export function Panel({
  variant,
  children,
  className = '',
}: {
  variant: 'shell' | 'card';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <div className={`panel-cap ${variant}-top`} aria-hidden="true" />
      <div className={`panel-tile ${variant}-tile ${variant}-inset -my-px`}>{children}</div>
      <div className={`panel-cap ${variant}-bottom`} aria-hidden="true" />
    </div>
  );
}
