import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, LoadingView, PrimaryButton, ScreenHeader } from './ui.jsx';

export default function SavedPdfsScreen({ goBack, uploadDraft, setUploadDraft }) {
  const [files, setFiles] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set(uploadDraft.existingSelected));
  const { confirmAsync } = useModals();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/saved-pdfs');
      setFiles(data);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (filename) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const remove = async (filename) => {
    const ok = await confirmAsync('Delete saved PDF?', `"${filename}" will be permanently deleted.`, 'Delete');
    if (!ok) return;
    try {
      await apiFetch(`/api/saved-pdfs/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const useSelected = () => {
    setUploadDraft((d) => ({ ...d, existingSelected: Array.from(selected) }));
    goBack();
  };

  return (
    <div className="screen">
      <ScreenHeader title="Saved PDFs" onBack={goBack} />
      <ErrorBanner message={error} />

      {files === null ? (
        <LoadingView label="Loading saved PDFs..." />
      ) : files.length === 0 ? (
        <p className="subtext">No saved PDFs yet. Upload one from the New Quiz screen.</p>
      ) : (
        files.map((f) => (
          <div key={f.filename} className="file-row">
            <button type="button" className="link-button file-row-text" style={{ textAlign: 'left' }} onClick={() => toggle(f.filename)}>
              {selected.has(f.filename) ? '☑' : '☐'} {f.filename}
            </button>
            <button type="button" className="link-button remove-text" onClick={() => remove(f.filename)}>
              Delete
            </button>
          </div>
        ))
      )}

      <PrimaryButton title={`Use Selected (${selected.size})`} onClick={useSelected} style={{ marginTop: 24 }} />
    </div>
  );
}
