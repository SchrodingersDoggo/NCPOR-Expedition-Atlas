import React, { useEffect, useState } from 'react';
import { ArrowBigDown, ArrowBigUp } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNetwork } from '../../context/NetworkContext.jsx';
import { formatCount } from './utils.js';

// Reddit's up / score / down pill. Optimistic: the UI changes instantly and
// rolls back if the request fails.
export default function VoteButtons({ score, myVote = 0, onVote, size = 'md' }) {
  const { isAuthenticated } = useAuth();
  const { isOffline } = useNetwork();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState({ score, myVote });
  const [busy, setBusy] = useState(false);

  useEffect(() => { setState({ score, myVote }); }, [score, myVote]);

  async function cast(direction, e) {
    e.stopPropagation();
    e.preventDefault();
    if (!isAuthenticated) { navigate('/login', { state: { from: location } }); return; }
    if (busy || isOffline) return;
    const next = state.myVote === direction ? 0 : direction;
    const prev = state;
    setState({ score: state.score - state.myVote + next, myVote: next });
    setBusy(true);
    try {
      const result = await onVote(next);
      if (result) setState({ score: result.score, myVote: result.myVote });
    } catch {
      setState(prev);
    } finally {
      setBusy(false);
    }
  }

  const icon = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const tone = state.myVote === 1 ? 'bg-[#ff4500] text-white' : state.myVote === -1 ? 'bg-[#7193ff] text-white' : 'bg-white/[0.06] text-slate-200';

  return (
    <div className={`inline-flex items-center rounded-full ${tone}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Upvote" onClick={(e) => cast(1, e)} className={`rounded-full p-1.5 ${state.myVote ? 'hover:bg-black/15' : 'hover:bg-white/10 hover:text-[#ff4500]'}`}>
        <ArrowBigUp className={icon} fill={state.myVote === 1 ? 'currentColor' : 'none'} />
      </button>
      <span className={`min-w-[1.5rem] text-center font-semibold ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>{formatCount(state.score)}</span>
      <button type="button" aria-label="Downvote" onClick={(e) => cast(-1, e)} className={`rounded-full p-1.5 ${state.myVote ? 'hover:bg-black/15' : 'hover:bg-white/10 hover:text-[#7193ff]'}`}>
        <ArrowBigDown className={icon} fill={state.myVote === -1 ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}
