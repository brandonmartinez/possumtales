import { Link } from 'react-router-dom';
import type { Post } from '../types';
import { formatDate, speakersOf } from '../lib/content';
import { slugOf, tagSlug } from '../lib/search';
import { Panel } from './Panel';
import { PostBody } from './PostBody';
import { Media } from './Media';

/** Photo posts were published without titles; give them something to be. */
export const displayTitle = (post: Post): string =>
  post.title || (post.categories.includes('Photos') ? 'Possum sighting' : 'Untitled');

/**
 * One quote on one torn strip of notebook paper.
 *
 * `full` renders the whole post (permalink page); otherwise the card is a
 * listing entry and links through to it.
 */
export function PostCard({ post, full = false }: { post: Post; full?: boolean }) {
  const title = displayTitle(post);
  const speakers = speakersOf(post);

  return (
    <Panel variant="card">
      <div className="py-1">
        <h2 className="card-title">
          {full ? title : <Link to={post.permalink}>{title}</Link>}
        </h2>

        {post.quote ? (
          <blockquote className="card-quote">
            {post.quote.split('\n').map((line, i) => (
              <p key={i}>&ldquo;{line}&rdquo;</p>
            ))}
          </blockquote>
        ) : null}

        {/* One citation line: who said it, and when. */}
        <p className="card-byline">
          {speakers.length ? (
            <span className="card-speaker">
              &mdash;{' '}
              {speakers.map((name, i) => (
                <span key={name}>
                  {i > 0 ? ' & ' : ''}
                  <Link to={`/speaker/${slugOf(name)}/`}>{name}</Link>
                </span>
              ))}
            </span>
          ) : null}
          <Link to={post.permalink} className="card-date">
            {formatDate(post.date)}
          </Link>
        </p>

        {post.context ? <p className="card-aside">{post.context}</p> : null}

        {/* "See <other post>." -- Joy cross-linked her own quotes constantly. */}
        {post.note ? <PostBody html={post.note} className="card-aside" /> : null}

        {/* Photos, Stories and the one announcement post have no parsed quote,
            so their original markup is the post. */}
        {!post.quote ? <PostBody html={post.html} className="mt-3 text-[14px]" /> : null}

        {post.media?.length ? <Media items={post.media} /> : null}

        {full && post.tags.length ? (
          <p className="card-tags">
            {post.tags.map((tag, i) => (
              <span key={tag}>
                {i > 0 ? ', ' : ''}
                <Link to={`/tag/${tagSlug(tag)}/`} className="font-normal">
                  {tag}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
