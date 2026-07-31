import { Panel } from '../components/Panel';
import { PostBody } from '../components/PostBody';
import { about, meta } from '../lib/content';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function About() {
  useDocumentTitle(about.title, 'Why Possum Tales? The story behind the quote book.');

  return (
    <main className="mx-auto max-w-[460px]">
      <Panel variant="card">
        <div className="py-2">
          <h1 className="mb-3 text-[2.2em] leading-none">{about.title}</h1>
          <PostBody html={about.html} />
          <p className="mt-5 border-t border-dashed border-faint pt-3 text-[12px] leading-6 text-muted italic">
            Joy wrote {meta.postCount} of these between {meta.years[0].year} and{' '}
            {meta.years[meta.years.length - 1].year}. The blog stopped; the archive didn&rsquo;t.
          </p>
        </div>
      </Panel>
    </main>
  );
}
