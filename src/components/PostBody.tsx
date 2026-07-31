import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Renders a post's stored HTML. The extract sanitizes it at build time (no
 * script tags, no event handlers, no Flash objects), so this is the one place
 * dangerouslySetInnerHTML is legitimate.
 *
 * Joy cross-linked her own posts constantly. Those hrefs are site-relative, so
 * catch the clicks and route them instead of reloading the whole app.
 */
export function PostBody({ html, className = '' }: { html: string; className?: string }) {
  const navigate = useNavigate();

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
        return;
      }
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href?.startsWith('/') || anchor.target === '_blank') return;
      // Image click-throughs point at /uploads/, which is a real static file.
      if (href.startsWith('/uploads/')) return;

      e.preventDefault();
      navigate(href);
    },
    [navigate]
  );

  return (
    <div
      className={`prose-possum ${className}`}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
