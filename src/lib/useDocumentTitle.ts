import { useEffect } from 'react';

const SITE = 'Possum Tales';

/**
 * Tiny replacement for react-helmet. A frozen archive needs a title and a
 * description; it does not need a dependency to set two DOM properties.
 */
export function useDocumentTitle(title?: string, description?: string) {
  useEffect(() => {
    document.title = title ? `${title} | ${SITE}` : SITE;
    if (description) {
      let tag = document.querySelector('meta[name="description"]');
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', 'description');
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', description);
    }
  }, [title, description]);
}
