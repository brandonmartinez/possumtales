import { Link } from 'react-router-dom';
import { Panel } from '../components/Panel';
import { PostCard } from '../components/PostCard';
import { posts } from '../lib/content';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** Even the 404 should be worth landing on. Here's a random quote. */
export function NotFound() {
  useDocumentTitle('Nothing here but trash');
  const consolation = posts[Math.floor(Math.random() * posts.length)];

  return (
    <main className="mx-auto max-w-[460px]">
      <Panel variant="card">
        <div className="py-3 text-center">
          <h1 className="mb-2 text-[2.2em] leading-none">This burrow is empty.</h1>
          <p className="text-[13px] leading-6 text-muted">
            Whatever used to be here got dragged off years ago. Here&rsquo;s something else the
            possum found:
          </p>
        </div>
      </Panel>

      <div className="mt-5">
        <PostCard post={consolation} />
      </div>

      <p className="mt-4 text-center text-[13px]">
        <Link to="/">Back to the burrow</Link>
      </p>
    </main>
  );
}
