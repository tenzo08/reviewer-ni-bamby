import { useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, PrimaryButton, SecondaryButton } from './ui.jsx';

const DIFFICULTIES = ['easy', 'medium', 'hard'];

export default function UploadScreen({ navigate, goHome, uploadDraft, setUploadDraft, onQuizGenerated }) {
  const { newFiles, existingSelected, numQuestions, difficulty } = uploadDraft;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const { askDuplicateResolution } = useModals();

  const pickFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    setUploadDraft((d) => ({
      ...d,
      newFiles: [...d.newFiles, ...picked.filter((p) => !d.newFiles.some((f) => f.name === p.name))],
    }));
  };

  const removeNewFile = (name) => {
    setUploadDraft((d) => ({ ...d, newFiles: d.newFiles.filter((f) => f.name !== name) }));
  };

  const removeExisting = (filename) => {
    setUploadDraft((d) => ({ ...d, existingSelected: d.existingSelected.filter((f) => f !== filename) }));
  };

  const submit = async (duplicateResolution = {}) => {
    setError('');
    if (newFiles.length === 0 && existingSelected.length === 0) {
      setError('Pick at least one PDF, or choose from previously saved files.');
      return;
    }
    setSubmitting(true);
    try {
      const formData = new FormData();
      for (const f of newFiles) {
        formData.append('files', f, f.name);
      }
      formData.append('existingFilenames', JSON.stringify(existingSelected));
      formData.append('settings', JSON.stringify({ numQuestions, difficulty }));
      if (Object.keys(duplicateResolution).length > 0) {
        formData.append('duplicateResolution', JSON.stringify(duplicateResolution));
      }

      let quiz;
      try {
        quiz = await apiFetch('/api/generate-quiz', { method: 'POST', formData, timeoutMs: 120000 });
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
          return submit(resolution);
        }
        throw e;
      }

      // Register the quiz in history right away (completed: false) so it's
      // resumable even if the tab closes before the quiz is finished.
      try {
        await apiFetch('/api/save-quiz-result', { method: 'POST', json: quiz });
      } catch (e) {
        // non-fatal: the quiz can still be played, just may not show in history yet
      }

      setUploadDraft({ newFiles: [], existingSelected: [], numQuestions: 5, difficulty: 'medium' });
      onQuizGenerated(quiz, difficulty);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="screen">
      <div className="header-row" style={{ marginBottom: 20 }}>
        <button type="button" className="back-button" onClick={goHome}>
          ‹ Back
        </button>
        <div style={{ flex: 1 }}>
          <h1 className="header-title">New Quiz</h1>
        </div>
      </div>
      <ErrorBanner message={error} />

      <p className="section-label">PDFs to use</p>

      {newFiles.map((f) => (
        <div key={f.name} className="file-row">
          <span className="file-row-text">📄 {f.name}</span>
          <button type="button" className="link-button remove-text" onClick={() => removeNewFile(f.name)}>
            Remove
          </button>
        </div>
      ))}
      {existingSelected.map((filename) => (
        <div key={filename} className="file-row">
          <span className="file-row-text">💾 {filename}</span>
          <button type="button" className="link-button remove-text" onClick={() => removeExisting(filename)}>
            Remove
          </button>
        </div>
      ))}
      {newFiles.length === 0 && existingSelected.length === 0 && (
        <p className="subtext">No PDFs selected yet.</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={pickFiles}
      />

      <div className="row-gap">
        <SecondaryButton title="Pick PDF(s)" onClick={() => fileInputRef.current?.click()} />
        <SecondaryButton title="Scan Pages" onClick={() => navigate('scanCapture')} />
      </div>
      <SecondaryButton title="Use Saved PDFs" onClick={() => navigate('savedPdfs')} style={{ marginTop: 12 }} />

      <p className="section-label">Number of questions</p>
      <input
        className="input"
        type="number"
        inputMode="numeric"
        min="1"
        max="30"
        value={numQuestions}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          setUploadDraft((d) => ({ ...d, numQuestions: Number.isNaN(n) ? '' : Math.min(n, 30) }));
        }}
      />

      <p className="section-label">Difficulty</p>
      <div className="row-gap">
        {DIFFICULTIES.map((d) => (
          <button
            type="button"
            key={d}
            className={`chip${difficulty === d ? ' active' : ''}`}
            onClick={() => setUploadDraft((prev) => ({ ...prev, difficulty: d }))}
          >
            {d}
          </button>
        ))}
      </div>

      <PrimaryButton title="Generate Quiz" onClick={() => submit()} loading={submitting} style={{ marginTop: 24 }} />
    </div>
  );
}
