import { useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, PrimaryButton, ScreenHeader, SecondaryButton } from './ui.jsx';

function defaultScanFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.pdf`;
}

export default function ScanCaptureScreen({ goBack, onScanned }) {
  const [pages, setPages] = useState([]);
  const [naming, setNaming] = useState(false);
  const [filename, setFilename] = useState(defaultScanFilename);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const captureInputRef = useRef(null);
  const { askDuplicateResolution } = useModals();

  const capture = (e) => {
    setError('');
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setPages((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, file, previewUrl: URL.createObjectURL(file) }]);
  };

  const removePage = (id) => setPages((prev) => prev.filter((p) => p.id !== id));

  const movePage = (index, direction) => {
    setPages((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const upload = async (duplicateResolution = {}) => {
    setError('');
    setSubmitting(true);
    try {
      const formData = new FormData();
      pages.forEach((page, i) => {
        formData.append('images', page.file, `page-${i + 1}.jpg`);
      });
      formData.append('filename', filename);
      if (Object.keys(duplicateResolution).length > 0) {
        formData.append('duplicateResolution', JSON.stringify(duplicateResolution));
      }

      let data;
      try {
        data = await apiFetch('/api/scan-to-pdf', { method: 'POST', formData, timeoutMs: 60000 });
      } catch (e) {
        if (e.status === 409 && e.data && Array.isArray(e.data.conflicts)) {
          const resolution = { ...duplicateResolution };
          for (const conflict of e.data.conflicts) {
            const choice = await askDuplicateResolution(conflict.filename);
            if (choice === 'cancel') {
              setSubmitting(false);
              return;
            }
            resolution[conflict.filename] = choice;
          }
          setSubmitting(false);
          return upload(resolution);
        }
        throw e;
      }

      onScanned(data.filename);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="screen">
      <ScreenHeader title="Scan Pages" onBack={goBack} />
      <ErrorBanner message={error} />

      {!naming ? (
        <>
          <p className="section-label">
            {pages.length} page{pages.length === 1 ? '' : 's'} captured
          </p>
          {pages.length === 0 && <p className="subtext">Tap "Scan a page" to take your first photo.</p>}
          {pages.map((page, i) => (
            <div key={page.id} className="scan-page-row">
              <img src={page.previewUrl} alt={`Page ${i + 1}`} className="scan-thumb" />
              <span className="subtext">{i + 1}</span>
              <div style={{ flex: 1 }} />
              <button type="button" className="link-button remove-text" onClick={() => movePage(i, -1)} disabled={i === 0}>
                ▲
              </button>
              <button
                type="button"
                className="link-button remove-text"
                onClick={() => movePage(i, 1)}
                disabled={i === pages.length - 1}
              >
                ▼
              </button>
              <button type="button" className="link-button remove-text" onClick={() => removePage(page.id)}>
                Remove
              </button>
            </div>
          ))}

          <input
            ref={captureInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={capture}
          />
          <PrimaryButton title="+ Scan a page" onClick={() => captureInputRef.current?.click()} style={{ marginTop: 16 }} />
          <SecondaryButton title="Done" onClick={() => setNaming(true)} disabled={pages.length === 0} style={{ marginTop: 12 }} />
        </>
      ) : (
        <>
          <p className="section-label">Filename</p>
          <input className="input" value={filename} onChange={(e) => setFilename(e.target.value)} />
          <div className="row-gap">
            <SecondaryButton title="Back" onClick={() => setNaming(false)} disabled={submitting} />
            <PrimaryButton title="Save PDF" onClick={() => upload()} loading={submitting} />
          </div>
        </>
      )}
    </div>
  );
}
