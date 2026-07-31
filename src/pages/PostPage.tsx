import { Link, Navigate, useParams } from 'react-router-dom';
import { PostCard, displayTitle } from '../components/PostCard';
import { findPost, neighbours } from '../lib/content';
import { categorySlug } from '../lib/search';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** A single quote, at its original 2005-2017 permalink. */
export function PostPage() {
  const { year = '', month = '', day = '', slug = '' } = useParams();
  const post = findPost(year, month, day, slug);

  useDocumentTitle(
    post ? displayTitle(post) : 'Not found',
    post ? (post.quote ?? post.context ?? displayTitle(post)).slice(0, 180) : undefined
  );

  if (!post) return <Navigate to="/404" replace />;

  const { older, newer } = neighbours(post);

  return (
    <main className="mx-auto max-w-[460px]">
      <p className="mb-3 text-[12px]">
        <Link to="/" className="font-normal">
          &larr; All quotes
        </Link>
      </p>

      <PostCard post={post} full />

      {/* The card carries the date, so this only has to place it in the album. */}
      <p className="mt-3 text-center text-[11px] text-muted">
        Filed under{' '}
        {post.categories.map((name, i) => (
          <span key={name}>
            {i > 0 ? ', ' : ''}
            <Link to={`/category/${categorySlug(name)}/`} className="font-normal text-muted">
              {name}
            </Link>
          </span>
        ))}
        .
      </p>

      <nav className="mt-4 flex justify-between gap-4 text-[12px]">
        {newer ? (
          <Link to={newer.permalink} className="max-w-[45%]">
            &larr; {displayTitle(newer)}
          </Link>
        ) : (
          <span />
        )}
        {older ? (
          <Link to={older.permalink} className="max-w-[45%] text-right">
            {displayTitle(older)} &rarr;
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
