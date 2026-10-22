import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, Sparkles } from 'lucide-react';
import { fetchCommunityUser } from '../../api/communities.js';
import PostList from '../../components/communities/PostList.jsx';
import ContactCard from '../../components/communities/ContactCard.jsx';
import Avatar from '../../components/communities/Avatar.jsx';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import { formatCount } from '../../components/communities/utils.js';

const ROLE = { researcher: 'Researcher', comms_officer: 'Comms Officer', admin: 'Admin', public: 'Member' };

// u/<name> — a person's community profile with their posts and a
// "Connect" card (social links + direct message).
export default function UserProfilePage() {
  const { id } = useParams();
  const [person, setPerson] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setPerson(null);
    fetchCommunityUser(id).then(setPerson).catch((err) => setError(err.response?.data?.error || 'User not found.'));
  }, [id]);

  if (error) return <div className="py-20 text-center text-slate-400">{error}</div>;
  if (!person) return <div className="py-20 text-center text-sm text-slate-500">Loading profile…</div>;

  return (
    <div className="mx-auto flex max-w-[1100px] gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-4">
          <Avatar user={person} size={72} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-white">{person.name}</h1>
            <p className="text-sm text-slate-400">u/{person.name} · {ROLE[person.role] || person.role}{person.organization ? ` · ${person.organization}` : ''}</p>
          </div>
        </div>
        {person.bio && <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-300">{person.bio}</p>}

        {/* Mobile: stats + connect sit above the posts */}
        <div className="mt-4 space-y-4 lg:hidden"><ContactCard person={person} /></div>

        <h2 className="mt-6 border-b border-white/10 pb-2 text-sm font-semibold text-white">Posts</h2>
        <PostList query={{ author: person.id, sort: 'new' }} empty={`u/${person.name} hasn't posted yet.`} />
      </div>

      <aside className="hidden w-[320px] shrink-0 space-y-4 lg:block">
        <section className="rounded-2xl border border-white/10 bg-[#0c222b] p-4">
          <h2 className="font-semibold text-white">{person.name}</h2>
          {person.designation && <p className="text-xs text-slate-400">{person.designation}</p>}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div><div className="inline-flex items-center gap-1 font-semibold text-white"><Sparkles className="h-3.5 w-3.5 text-[#ffb000]" />{formatCount(person.karma)}</div><div className="text-[11px] text-slate-500">Karma</div></div>
            <div><div className="font-semibold text-white">{formatCount(person.postCount)}</div><div className="text-[11px] text-slate-500">Posts</div></div>
            <div className="col-span-2"><div className="inline-flex items-center gap-1 text-sm text-white"><CalendarDays className="h-3.5 w-3.5" /> {new Date(person.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div><div className="text-[11px] text-slate-500">Member since</div></div>
          </div>
          {person.role === 'researcher' && (
            <Link to={`/researchers/${person.id}`} className="mt-4 block rounded-full border border-white/15 py-2 text-center text-xs font-semibold text-slate-200 hover:bg-white/5">View research profile</Link>
          )}
        </section>

        <ContactCard person={person} />

        {person.moderates.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-[#0c222b] p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Moderator of</h2>
            <ul className="mt-2 space-y-1.5">
              {person.moderates.map((c) => (
                <li key={c.slug}><Link to={`/communities/c/${c.slug}`} className="flex items-center gap-2 text-sm text-slate-200 hover:underline"><CommunityIcon community={c} size={24} /> c/{c.slug}</Link></li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
