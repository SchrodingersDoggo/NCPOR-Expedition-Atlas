import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFeed } from '../../api/communities.js';
import { useNetwork } from '../../context/NetworkContext.jsx';
import PostCard from './PostCard.jsx';

// Paged feed. Auto-loads the next page when you reach the bottom on a good
// connection; on low bandwidth it waits for an explicit "Load more".
export default function PostList({ query, empty, hideCommunity, canModerate, onMeta }) {
  const { isSlow, isOffline } = useNetwork();
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sentinel = useRef(null);
  const key = JSON.stringify(query);

  const load = useCallback(async (nextPage) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchFeed({ ...query, page: nextPage, limit: isSlow ? 8 : 15 });
      setPosts((prev) => (nextPage === 0 ? data.posts : [...prev, ...data.posts.filter((p) => !prev.some((x) => x.id === p.id))]));
      setHasMore(data.hasMore);
      setPage(nextPage);
      onMeta?.(data);
    } catch (err) {
      setError(err.response?.data?.error || (isOffline ? 'You are offline.' : 'Could not load posts.'));
    } finally {
      setLoading(false);
    }
  }, [key, isSlow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPosts([]); load(0); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isSlow || !hasMore || !sentinel.current) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading) load(page + 1);
    }, { rootMargin: '400px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [isSlow, hasMore, loading, page, load]);

  return (
    <div>
      {error && <p className="my-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      <div className="divide-y divide-white/10">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} hideCommunity={hideCommunity} canModerate={canModerate} onDeleted={(id) => setPosts((list) => list.filter((x) => x.id !== id))} />
        ))}
      </div>
      {!loading && !error && posts.length === 0 && (
        <div className="py-16 text-center text-sm text-slate-500">{empty || 'No posts yet.'}</div>
      )}
      {loading && <div className="py-8 text-center text-sm text-slate-500">Loading posts…</div>}
      {hasMore && !loading && (
        <div ref={sentinel} className="flex justify-center py-6">
          <button type="button" onClick={() => load(page + 1)} className="rounded-full border border-white/15 px-5 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5">Load more</button>
        </div>
      )}
    </div>
  );
}
