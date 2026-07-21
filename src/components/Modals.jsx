import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { PrimaryButton, SecondaryButton } from './ui.jsx';

const ModalContext = createContext(null);

// Web replacement for the mobile app's Alert.alert-based confirmAsync /
// askDuplicateResolution helpers -- same three-choice duplicate-file prompt
// (Replace / Use Existing / Cancel) and same confirm/cancel dialog, just a
// modal instead of a native Alert.
export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((value) => {
    setModal(null);
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
  }, []);

  const confirmAsync = useCallback((title, message, confirmLabel = 'Confirm', destructive = true) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setModal({ type: 'confirm', title, message, confirmLabel, destructive });
    });
  }, []);

  const askDuplicateResolution = useCallback((filename) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setModal({
        type: 'duplicate',
        title: 'File already exists',
        message: `"${filename}" is already saved from a previous upload. What would you like to do?`,
      });
    });
  }, []);

  return (
    <ModalContext.Provider value={{ confirmAsync, askDuplicateResolution }}>
      {children}
      {modal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 className="modal-title">{modal.title}</h2>
            <p className="modal-message">{modal.message}</p>
            <div className="modal-actions">
              {modal.type === 'duplicate' ? (
                <>
                  <PrimaryButton title="Replace" onClick={() => close('replace')} />
                  <SecondaryButton title="Use Existing" onClick={() => close('useExisting')} />
                  <SecondaryButton title="Cancel" onClick={() => close('cancel')} />
                </>
              ) : (
                <>
                  <PrimaryButton
                    title={modal.confirmLabel}
                    onClick={() => close(true)}
                    style={modal.destructive ? { background: 'var(--incorrect)' } : undefined}
                  />
                  <SecondaryButton title="Cancel" onClick={() => close(false)} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}

export function useModals() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModals must be used within a ModalProvider');
  return ctx;
}
