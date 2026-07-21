import { useEffect, useRef } from 'react';

// Scoped per rules.md #8: only guards while an upload or quiz-generation
// request is actually in flight -- never for normal idle navigation.
// `inFlight` is read through a ref (not just the raw prop) so the
// beforeunload/popstate listeners -- registered once -- always see the
// latest value without needing to be torn down/re-registered on every
// change, which would risk a brief unguarded window between renders.
//
// `onGuardedBack` is called only when the user presses browser Back while
// inFlight is true; it receives a `proceed()` callback the caller invokes
// after confirming (or not) to either let the back navigation continue or
// stay put. We push one history entry when an operation starts so a Back
// press is caught by `popstate` here instead of leaving the SPA entirely
// (this app has no other real per-screen history entries to fall back on).
export function useProgressGuard(inFlight, onGuardedBack) {
  const inFlightRef = useRef(inFlight);
  inFlightRef.current = inFlight;

  const onGuardedBackRef = useRef(onGuardedBack);
  onGuardedBackRef.current = onGuardedBack;

  const checkpointedRef = useRef(false);
  const programmaticBackRef = useRef(false);

  useEffect(() => {
    if (inFlight && !checkpointedRef.current) {
      checkpointedRef.current = true;
      window.history.pushState({ progressGuardCheckpoint: true }, '');
    }
    if (!inFlight) {
      checkpointedRef.current = false;
    }
  }, [inFlight]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!inFlightRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };

    const handlePopState = () => {
      if (programmaticBackRef.current) {
        programmaticBackRef.current = false;
        return;
      }
      if (!inFlightRef.current) return;
      // Neutralize the back navigation immediately (re-add the checkpoint)
      // so the user visibly stays put while the confirm dialog is shown.
      window.history.pushState({ progressGuardCheckpoint: true }, '');
      onGuardedBackRef.current?.(() => {
        programmaticBackRef.current = true;
        window.history.back();
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);
}
