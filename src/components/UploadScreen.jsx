import { useRef, useState } from 'react';
import { apiFetch, uploadToSignedUrl } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, PrimaryButton, SecondaryButton } from './ui.jsx';

const DIFFICULTIES = ['easy', 'medium', 'hard'];

const QUESTION_TYPES = [
  { value: 'multipleChoice', label: 'Multiple Choice' },
  { value: 'trueFalse', label: 'True or False' },
  { value: 'modifiedTrueFalse', label: 'Modified True or False' },
  { value: 'identification', label: 'Identification' },
  { value: 'mixed', label: 'Mixed' },
];

export default function UploadScreen({
  navigate,
  goHome,
  uploadDraft,
  setUploadDraft,
  onQuizGenerated,
  beginOperation,
  endOperation,
}) {
  const { newFiles, existingSelected, numQuestions, difficulty, questionType } = uploadDraft;
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
    const controller = new AbortController();
    beginOperation(controller);
    try {
      // Step 1: resolve duplicate-filename conflicts and get a signed
      // Storage upload URL per new file (see api/prepare-upload.js). This
      // request is tiny (just filenames) regardless of PDF size.
      if (newFiles.length > 0) {
        let prep;
        try {
          prep = await apiFetch('/api/prepare-upload', {
            method: 'POST',
            json: { filenames: newFiles.map((f) => f.name), duplicateResolution },
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
            return submit(resolution);
          }
          throw e;
        }

        // Step 2: PUT each new file straight to Supabase Storage using its
        // signed URL -- this never touches the Vercel function body, which
        // is what actually avoids the platform's request-size limit for
        // larger PDFs.
        for (const f of newFiles) {
          if (controller.signal.aborted) return;
          const upload = prep.uploads[f.name];
          if (!upload || upload.useExisting) continue;
          await uploadToSignedUrl(upload.signedUrl, f, controller.signal);
        }
      }

      if (controller.signal.aborted) return;

      const sourcePdfs = [...newFiles.map((f) => f.name), ...existingSelected];

      let quiz;
      try {
        quiz = await apiFetch('/api/generate-quiz', {
          method: 'POST',
          json: { sourcePdfs, settings: { numQuestions, difficulty, questionType } },
          timeoutMs: 120000,
          signal: controller.signal,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e.status === 400 && e.data && Array.isArray(e.data.oversizedFiles) && e.data.oversizedFiles.length > 0) {
          // A PDF over the 100-page limit shouldn't block the rest of the
          // selection (docs/design.md "PDF page count limit") -- remove
          // just the offending file(s) from the draft so the remaining
          // valid files are immediately ready to submit again, instead of
          // leaving the user to figure out which one was the problem.
          const oversizedNames = new Set(e.data.oversizedFiles.map((f) => f.filename));
          setUploadDraft((d) => ({
            ...d,
            newFiles: d.newFiles.filter((f) => !oversizedNames.has(f.name)),
            existingSelected: d.existingSelected.filter((name) => !oversizedNames.has(name)),
          }));
          setError(e.message);
          setSubmitting(false);
          endOperation();
          return;
        }
        throw e;
      }

      // The user may have confirmed "leave anyway" on the progress-loss
      // guard while this was in flight -- don't surprise-navigate them
      // into a quiz they already walked away from.
      if (controller.signal.aborted) return;

      // Register the quiz in history right away (completed: false) so it's
      // resumable even if the tab closes before the quiz is finished.
      try {
        await apiFetch('/api/save-quiz-result', { method: 'POST', json: quiz });
      } catch (e) {
        // non-fatal: the quiz can still be played, just may not show in history yet
      }

      setUploadDraft({ newFiles: [], existingSelected: [], numQuestions: 5, difficulty: 'medium', questionType: 'multipleChoice' });
      onQuizGenerated(quiz, difficulty);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      setSubmitting(false);
      endOperation();
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

      <SecondaryButton title="Pick PDF(s)" onClick={() => fileInputRef.current?.click()} />
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

      <p className="section-label">Question type</p>
      <div className="chip-group">
        {QUESTION_TYPES.map((t) => (
          <button
            type="button"
            key={t.value}
            className={`chip${questionType === t.value ? ' active' : ''}`}
            onClick={() => setUploadDraft((prev) => ({ ...prev, questionType: t.value }))}
          >
            {t.label}
          </button>
        ))}
      </div>

      <PrimaryButton title="Generate Quiz" onClick={() => submit()} loading={submitting} style={{ marginTop: 24 }} />
    </div>
  );
}
