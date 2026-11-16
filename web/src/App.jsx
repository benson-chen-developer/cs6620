import { useEffect, useState } from 'react';
import './App.css';
import ScansPage from './ScansPage.jsx';

const DEFAULT_EMAIL = 'dev@example.com';

export default function App() {
  // Not real auth: just lets you pick which email to act as.
  const [email, setEmail] = useState(
    () => localStorage.getItem('email') || DEFAULT_EMAIL
  );
  const [page, setPage] = useState('targets');
  const [switching, setSwitching] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  function chooseEmail(raw) {
    const next = raw.trim().toLowerCase();
    setEmail(next);
    localStorage.setItem('email', next);
    setTargets([]);
    setError('');
    setSwitching(false);
  }

  function handleEmailSubmit(e) {
    e.preventDefault();
    chooseEmail(emailInput);
    setEmailInput('');
  }

  const [url, setUrl] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [targets, setTargets] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadTargets(isStale = () => false) {
    try {
      const res = await fetch(`/targets?ownerId=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load targets.');
      if (!isStale()) setTargets(data);
    } catch (err) {
      if (!isStale()) setError(err.message);
    }
  }

  useEffect(() => {
    let stale = false;
    loadTargets(() => stale);
    return () => {
      stale = true;
    };
  }, [email]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, frequency, email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register target.');
      setUrl('');
      await loadTargets();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (switching) {
    return (
      <main className="app">
        <header className="header">
          <h1>Pentest Scheduler</h1>
        </header>
        <section className="card">
          <h2>Choose an email</h2>
          <button
            className="btn"
            type="button"
            onClick={() => chooseEmail(DEFAULT_EMAIL)}
          >
            Use {DEFAULT_EMAIL}
          </button>
          <form className="form" onSubmit={handleEmailSubmit} style={{ marginTop: 12 }}>
            <input
              type="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              required
            />
            <button className="btn" type="submit">Continue</button>
          </form>
          <button
            className="btn"
            type="button"
            style={{ marginTop: 12 }}
            onClick={() => setSwitching(false)}
          >
            Cancel
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="header">
        <h1>Pentest Scheduler</h1>
        <button
          type="button"
          className="user-chip"
          title="Change email"
          onClick={() => setSwitching(true)}
        >
          {email} ▾
        </button>
      </header>

      <nav className="nav">
        <button
          type="button"
          className={page === 'targets' ? 'active' : ''}
          onClick={() => setPage('targets')}
        >
          Targets
        </button>
        <button
          type="button"
          className={page === 'scans' ? 'active' : ''}
          onClick={() => setPage('scans')}
        >
          Scans
        </button>
      </nav>

      {page === 'scans' ? (
        <ScansPage email={email} />
      ) : (
        <>
      <section className="card">
        <h2>Register a target</h2>
        <form className="form" onSubmit={handleSubmit}>
          <input
            type="url"
            placeholder="https://api.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add target'}
          </button>
        </form>
        {error && <div className="error">{error}</div>}
      </section>

      <section className="card">
        <h2>Your targets ({targets.length})</h2>
        {targets.length === 0 ? (
          <p className="empty">No targets yet. Add one above.</p>
        ) : (
          <ul className="target-list">
            {targets.map((t) => (
              <li className="target" key={t.targetId}>
                <div>
                  <div className="target-url">{t.url}</div>
                  <div className="target-meta">
                    Next run: {new Date(t.nextRunAt).toLocaleString()}
                  </div>
                </div>
                <div className="badges">
                  <span className="badge">{t.frequency}</span>
                  <span className={`badge ${t.status}`}>{t.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      )}
    </main>
  );
}
