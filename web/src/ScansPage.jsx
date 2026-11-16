import { useEffect, useState } from 'react';

// Scan ids are ISO timestamps; fall back to the raw id if one isn't.
function formatScanTime(scanId) {
  const d = new Date(scanId);
  return Number.isNaN(d.getTime()) ? `Scan ${scanId}` : d.toLocaleString();
}

export default function ScansPage({ email }) {
  const [scans, setScans] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // scan whose report popup is open
  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState('');
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setScans([]);
    setSelected(null);
    (async () => {
      try {
        const res = await fetch(`/scans/?ownerId=${encodeURIComponent(email)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load scans.');
        if (!cancelled) {
          setScans(data);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function openReport(scan) {
    setSelected(scan);
    setReport(null);
    setReportError('');
    setReportLoading(true);
    try {
      const res = await fetch(`/scans/report?reportKey=${encodeURIComponent(scan.reportKey)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load report.');
      setReport(data);
    } catch (err) {
      setReportError(err.message);
    } finally {
      setReportLoading(false);
    }
  }

  function closeReport() {
    setSelected(null);
  }

  // Close the popup with Escape.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <section className="card">
      <h2>Your scans ({scans.length})</h2>
      {error && <div className="error">{error}</div>}
      {loading ? (
        <p className="empty">Loading…</p>
      ) : scans.length === 0 ? (
        <p className="empty">No scans yet. They appear after a target's first scheduled run.</p>
      ) : (
        <ul className="target-list">
          {scans.map((s) => (
            <li key={`${s.targetId}/${s.scanId}`} className="scan-item">
              <button
                type="button"
                className="scan-row"
                onClick={() => openReport(s)}
              >
                <div className="scan-main">
                  <div className="scan-url">{s.url}</div>
                  <div className="scan-time">{formatScanTime(s.scanId)}</div>
                  {s.counts && (
                    <div className="scan-counts">
                      <span className="count fail">{s.counts.fail} failed</span>
                      <span className="count warn">{s.counts.warning} warnings</span>
                      <span className="count pass">{s.counts.pass} passed</span>
                    </div>
                  )}
                </div>
                <div className="scan-side">
                  <span className={`badge scan-status ${s.status}`}>{s.status}</span>
                  <span className="scan-chevron" aria-hidden="true">›</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="modal-backdrop" onClick={closeReport}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Scan report</h2>
                <div className="target-meta">
                  {report?.targetUrl || selected.url} · {selected.scanId}
                </div>
              </div>
              <button type="button" className="modal-close" onClick={closeReport}>
                ✕
              </button>
            </div>

            {reportLoading && <p className="empty">Loading report…</p>}
            {reportError && <div className="error">{reportError}</div>}

            {report && (
              <>
                <div className="summary">
                  <div className="stat"><strong>{report.summary.totalTests}</strong>Total</div>
                  <div className="stat PASS"><strong>{report.summary.passed}</strong>Passed</div>
                  <div className="stat FAIL"><strong>{report.summary.failed}</strong>Failed</div>
                  <div className="stat WARNING"><strong>{report.summary.warnings}</strong>Warnings</div>
                  <div className="stat ERROR"><strong>{report.summary.errors}</strong>Errors</div>
                </div>
                <div className="target-meta">
                  Scanned {new Date(report.scannedAt).toLocaleString()}
                </div>

                <ul className="results">
                  {report.results.map((r) => (
                    <li className="result" key={r.id}>
                      <div className="result-top">
                        <span className="result-name">{r.name}</span>
                        <span className="badges">
                          <span className="badge">{r.severity}</span>
                          <span className={`badge status-${r.status}`}>{r.status}</span>
                        </span>
                      </div>
                      {r.details && <div className="target-meta">{r.details}</div>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
