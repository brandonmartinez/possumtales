import type { Media as MediaItem } from '../types';

/**
 * Four posts in the Videos category were WordPress auto-embeds. Two are still
 * playable on YouTube; the other two are not, and the honest thing is to say so
 * and keep the outbound link, rather than render a dead <object> or an empty
 * iframe the way the original page does today.
 */
export function Media({ items }: { items: MediaItem[] }) {
  const playable = items.filter((i) => i.kind === 'youtube' && i.id);
  const broken = items.filter((i) => !(i.kind === 'youtube' && i.id));

  return (
    <div className="my-4 space-y-4">
      {playable.map((item) => (
        <div key={item.id} className="relative aspect-video w-full overflow-hidden bg-black/80">
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${item.id}`}
            title="Video"
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ))}

      {broken.length ? (
        <p className="border-l-2 border-faint pl-3 text-[12px] leading-6 text-muted">
          {broken.length === 1 ? 'A video played here. ' : `${broken.length} videos played here. `}
          {broken[0].note}{' '}
          {broken.length === 1 ? (
            <a href={broken[0].url} target="_blank" rel="noreferrer noopener">
              Original link
            </a>
          ) : (
            broken.map((item, i) => (
              <span key={item.url}>
                {i > 0 ? ', ' : ''}
                <a href={item.url} target="_blank" rel="noreferrer noopener">
                  link {i + 1}
                </a>
              </span>
            ))
          )}
        </p>
      ) : null}
    </div>
  );
}
