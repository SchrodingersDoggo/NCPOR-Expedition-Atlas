import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Globe, Mail, MessageSquare, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

// Text badges stand in for brand logos (lucide v1 ships no brand icons).
function Badge({ label, color }) {
  return (
    <span style={{ background: color }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white">
      {label}
    </span>
  );
}

function orcidUrl(id) {
  return `https://orcid.org/${id}`;
}

// "Connect" section on a researcher / community profile: social links the
// person chose to share, plus a direct-message button.
export default function ContactCard({ person, title = 'Connect', className = '' }) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  if (!person) return null;
  const isMe = user?.id === person.id;

  const links = [
    person.linkedinUrl && { href: person.linkedinUrl, label: 'LinkedIn', icon: <Badge label="in" color="#0a66c2" /> },
    person.researchGateUrl && { href: person.researchGateUrl, label: 'ResearchGate', icon: <Badge label="RG" color="#00ccbb" /> },
    person.orcidId && { href: orcidUrl(person.orcidId), label: `ORCID ${person.orcidId}`, icon: <Badge label="iD" color="#a6ce39" /> },
    person.twitterUrl && { href: person.twitterUrl, label: 'X / Twitter', icon: <Badge label="X" color="#111" /> },
    person.githubUrl && { href: person.githubUrl, label: 'GitHub', icon: <Badge label="GH" color="#333" /> },
    person.personalProfileUrl && { href: person.personalProfileUrl, label: 'Website', icon: <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/10"><Globe className="h-4 w-4 text-slate-200" /></span> },
    person.email && { href: `mailto:${person.email}`, label: person.email, icon: <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/10"><Mail className="h-4 w-4 text-slate-200" /></span> },
    person.mobileNumber && { href: `tel:${person.mobileNumber}`, label: person.mobileNumber, icon: <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/10"><Phone className="h-4 w-4 text-slate-200" /></span> },
  ].filter(Boolean);

  function message() {
    if (!isAuthenticated) { navigate('/login', { state: { from: { pathname: `/messages?to=${person.id}` } } }); return; }
    navigate(`/messages?to=${person.id}`);
  }

  return (
    <section className={`rounded-2xl border border-white/10 bg-[#0c222b] p-5 ${className}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      {!isMe && (
        <button type="button" onClick={message} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-300 px-4 py-2.5 text-sm font-bold text-[#06202a] hover:bg-cyan-200">
          <MessageSquare className="h-4 w-4" /> Message {person.name?.split(' ')[0]}
        </button>
      )}
      {links.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {links.map((l) => (
            <li key={l.label}>
              <a href={l.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5">
                {l.icon}<span className="truncate">{l.label}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-slate-500">
          {isMe ? <>You haven't added any contact links. <Link to="/profile" className="text-cyan-300 hover:underline">Add them in your profile</Link>.</> : 'No public contact links shared yet — send a direct message instead.'}
        </p>
      )}
      {isMe && links.length > 0 && <Link to="/profile" className="mt-3 inline-block text-xs text-cyan-300 hover:underline">Edit contact links</Link>}
    </section>
  );
}
