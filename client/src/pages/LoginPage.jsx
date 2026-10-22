import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If ProtectedRoute redirected here, send the user back where they were
  // headed once login succeeds. Otherwise just go home.
  const from = location.state?.from?.pathname || '/';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check your credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="chart-backdrop absolute inset-0 flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="brass-plate w-full max-w-sm rounded-2xl p-8"
      >
        <span className="rivet-tl" /><span className="rivet-tr" /><span className="rivet-bl" /><span className="rivet-br" />

        <div className="flex items-center gap-2 mb-5" style={{ color: 'var(--brass-bright)' }}>
          <Compass className="w-5 h-5" strokeWidth={1.5} />
          <span className="gauge-text text-[11px] tracking-wide">NCPOR EXPEDITION ATLAS</span>
        </div>

        <h1 className="text-2xl italic mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}>
          Sign in
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--ice-dim)' }}>Access the NCPOR portal</p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        <label className="block text-sm mb-1" style={{ color: 'var(--ice-dim)' }}>Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded text-white placeholder:text-slate-600 focus:outline-none transition-colors"
          style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--brass-bright)')}
          onBlur={(e) => (e.target.style.borderColor = 'var(--brass-dim)')}
        />

        <label className="block text-sm mb-1" style={{ color: 'var(--ice-dim)' }}>Password</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-6 px-3 py-2 rounded text-white placeholder:text-slate-600 focus:outline-none transition-colors"
          style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--brass-bright)')}
          onBlur={(e) => (e.target.style.borderColor = 'var(--brass-dim)')}
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded text-[#071620] font-semibold transition-opacity disabled:opacity-50"
          style={{ background: 'linear-gradient(160deg, var(--brass-bright), var(--brass))' }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-sm mt-4 text-center" style={{ color: 'var(--ice-dim)' }}>
          Don't have an account?{' '}
          <Link to="/register" className="hover:underline" style={{ color: 'var(--brass-bright)' }}>Register</Link>
        </p>
      </form>
    </div>
  );
}
