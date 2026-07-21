import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { autoCropImage } from '../lib/scanCrop.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, PrimaryButton, ScreenHeader, SecondaryButton } from './ui.jsx';

function defaultScanFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.pdf`;
}

function makePageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Scan staging screen (docs/design.md "Scan-to-PDF flow (revised)"): a
// capture -> auto-crop -> review/reorder staging area, distinct from a
// straight-through capture loop. Per docs/rules.md #7, nothing here calls
// any api/* route -- only the final "Compile PDF" action does, in one
// request with the same shape /api/scan-to-pdf already expected.
export default function ScanStagingScreen({ goBack, onScanned, beginOperation, endOperation }) {
  const [pages, setPages] = useState([]);
  const [naming, setNaming] = useState(false);
  const [filename, setFilename] = useState(defaultScanFilename);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const captureInputRef = useRef(null);
  const recaptureTargetRef = useRef(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const { askDuplicateResolution } = useModals();

  useEffect(
    () => () => {
      for (const p of pagesRef.current) {
        URL.revokeObjectURL(p.originalPreviewUrl);
        if (p.croppedPreviewUrl) URL.revokeObjectURL(p.croppedPreviewUrl);
      }
    },
    [],
  );

  const openCapture = (targetId) => {
    recaptureTargetRef.current = targetId;
    captureInputRef.current?.click();
  };

  const capture = async (e) => {
    setError('');
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const targetId = recaptureTargetRef.current;
    recaptureTargetRef.current = null;
    const id = targetId || makePageId();
    const originalPreviewUrl = URL.createObjectURL(file);

    const freshPage = {
      id,
      originalFile: file,
      originalPreviewUrl,
      croppedBlob: null,
      croppedPreviewUrl: null,
      cropStatus: 'processing',
      useOriginal: false,
    };

    setPages((prev) => {
      const existing = targetId ? prev.find((p) => p.id === targetId) : null;
      if (existing) {
        URL.revokeObjectURL(existing.originalPreviewUrl);
        if (existing.croppedPreviewUrl) URL.revokeObjectURL(existing.croppedPreviewUrl);
        return prev.map((p) => (p.id === targetId ? freshPage : p));
      }
      return [...prev, freshPage];
    });

    // Client-side edge detection + perspective correction only -- never a
    // network call. Best-effort: on any failure the page just falls back
    // to the uncropped original (see scanCrop.js / rules.md #7).
    const result = await autoCropImage(file);
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (result.success) {
          return {
            ...p,
            croppedBlob: result.blob,
            croppedPreviewUrl: URL.createObjectURL(result.blob),
            cropStatus: 'done',
          };
        }
        return { ...p, cropStatus: 'failed', useOriginal: true };
      }),
    );
  };

  const removePage = (id) => {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        URL.revokeObjectURL(target.originalPreviewUrl);
        if (target.croppedPreviewUrl) URL.revokeObjectURL(target.croppedPreviewUrl);
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  const movePage = (index, direction) => {
    setPages((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggleUseOriginal = (id) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, useOriginal: !p.useOriginal } : p)));
  };

  const compile = async (duplicateResolution = {}) => {
    setError('');
    setSubmitting(true);
    const controller = new AbortController();
    beginOperation(controller);
    try {
      const formData = new FormData();
      pages.forEach((page, i) => {
        const useOriginal = page.useOriginal || !page.croppedBlob;
        const source = useOriginal ? page.originalFile : page.croppedBlob;
        formData.append('images', source, `page-${i + 1}.jpg`);
      });
      formData.append('filename', filename);
      if (Object.keys(duplicateResolution).length > 0) {
        formData.append('duplicateResolution', JSON.stringify(duplicateResolution));
      }

      let data;
      try {
        data = await apiFetch('/api/scan-to-pdf', {
          method: 'POST',
          formData,
          timeoutMs: 60000,
          signal: controller.signal,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e.status === 409 && e.data && Array.isArray(e.data.conflicts)) {
          const resolution = { ...duplicateResolution };
          for (const conflict of e.data.conflicts) {
            const choice = await askDuplicateResolution(conflict.filename);
            if (choice === 'cancel') {
              setSubmitting(false);
              endOperation();
              return;
            }
            resolution[conflict.filename] = choice;
          }
          setSubmitting(false);
          endOperation();
          return compile(resolution);
        }
        throw e;
      }

      if (controller.signal.aborted) return;
      onScanned(data.filename);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      setSubmitting(false);
      endOperation();
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

          <div className="scan-grid">
            {pages.map((page, i) => {
              const useOriginal = page.useOriginal || !page.croppedBlob;
              const displayUrl = useOriginal ? page.originalPreviewUrl : page.croppedPreviewUrl;
              return (
                <div key={page.id} className="scan-card">
                  <div className="scan-card-thumb-wrap">
                    <img src={displayUrl} alt={`Page ${i + 1}`} className="scan-card-thumb" />
                    {page.cropStatus === 'processing' && (
                      <div className="scan-card-overlay">
                        <span className="spinner" style={{ width: 22, height: 22 }} />
                      </div>
                    )}
                    <span className="scan-card-badge">{i + 1}</span>
                  </div>

                  {page.cropStatus === 'failed' && <p className="subtext scan-card-note">Auto-crop unavailable -- using original</p>}
                  {page.cropStatus === 'done' && (
                    <button type="button" className="link-button scan-card-toggle" onClick={() => toggleUseOriginal(page.id)}>
                      {useOriginal ? 'Use auto-cropped version' : 'Use original instead'}
                    </button>
                  )}

                  <div className="scan-card-actions">
                    <button type="button" className="link-button" onClick={() => movePage(i, -1)} disabled={i === 0} aria-label="Move up">
                      ▲
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => movePage(i, 1)}
                      disabled={i === pages.length - 1}
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                    <button type="button" className="link-button" onClick={() => openCapture(page.id)}>
                      Recapture
                    </button>
                    <button type="button" className="link-button remove-text" onClick={() => removePage(page.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <input
            ref={captureInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={capture}
          />
          <PrimaryButton title="+ Scan a page" onClick={() => openCapture(null)} style={{ marginTop: 16 }} />
          <SecondaryButton title="Compile PDF" onClick={() => setNaming(true)} disabled={pages.length === 0} style={{ marginTop: 12 }} />
        </>
      ) : (
        <>
          <p className="section-label">Filename</p>
          <input className="input" value={filename} onChange={(e) => setFilename(e.target.value)} />
          <div className="row-gap">
            <SecondaryButton title="Back" onClick={() => setNaming(false)} disabled={submitting} />
            <PrimaryButton title="Compile PDF" onClick={() => compile()} loading={submitting} />
          </div>
        </>
      )}
    </div>
  );
}
