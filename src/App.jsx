import { useCallback, useRef, useState } from 'react';
import { getToken, clearToken } from './lib/apiClient.js';
import { useProgressGuard } from './lib/progressGuard.js';
import { ModalProvider, useModals } from './components/Modals.jsx';
import PasswordGate from './components/PasswordGate.jsx';
import HomeScreen from './components/HomeScreen.jsx';
import UploadScreen from './components/UploadScreen.jsx';
import SavedPdfsScreen from './components/SavedPdfsScreen.jsx';
import ScanStagingScreen from './components/ScanStagingScreen.jsx';
import QuizScreen from './components/QuizScreen.jsx';
import ScoreScreen from './components/ScoreScreen.jsx';
import ReviewMissedScreen from './components/ReviewMissedScreen.jsx';
import HistoryScreen from './components/HistoryScreen.jsx';
import HistoryDetailScreen from './components/HistoryDetailScreen.jsx';
import WeakSpotsScreen from './components/WeakSpotsScreen.jsx';
import AnalyticsScreen from './components/AnalyticsScreen.jsx';

const emptyUploadDraft = {
  newFiles: [],
  existingSelected: [],
  numQuestions: 5,
  difficulty: 'medium',
  questionType: 'multipleChoice',
};

const PROGRESS_LOSS_MESSAGE = 'Uploading/generating is still in progress. Leaving now will stop it. Continue anyway?';

function AppShell() {
  const [screen, setScreen] = useState('home');
  const [screenParams, setScreenParams] = useState({});
  const [uploadDraft, setUploadDraft] = useState(emptyUploadDraft);
  const [quiz, setQuiz] = useState(null);
  const [difficulty, setDifficulty] = useState('medium');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inFlight, setInFlight] = useState(false);
  const activeControllerRef = useRef(null);
  const { confirmAsync } = useModals();

  // Handed down to UploadScreen/ScanStagingScreen: call beginOperation()
  // right before starting an upload/generate-quiz fetch (with the
  // AbortController driving that fetch's `signal`), and endOperation()
  // in its `finally` block. This is the only thing that flips `inFlight`
  // -- regenerate-question, saved-pdfs browsing, etc. never touch it, per
  // rules.md #8 (scoped, not global).
  const beginOperation = useCallback((controller) => {
    activeControllerRef.current = controller;
    setInFlight(true);
  }, []);
  const endOperation = useCallback(() => {
    activeControllerRef.current = null;
    setInFlight(false);
  }, []);

  const confirmAndAbandon = useCallback(async () => {
    const ok = await confirmAsync('Leave this page?', PROGRESS_LOSS_MESSAGE, 'Leave', true);
    if (ok) {
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      setInFlight(false);
    }
    return ok;
  }, [confirmAsync]);

  // Browser Back while an operation is in flight: useProgressGuard already
  // neutralizes the pop and calls us with a `proceed` callback that
  // actually performs the back navigation once we're done confirming.
  const handleGuardedBack = useCallback(
    async (proceed) => {
      const ok = await confirmAndAbandon();
      if (ok) proceed();
    },
    [confirmAndAbandon],
  );
  useProgressGuard(inFlight, handleGuardedBack);

  // Every in-app navigation (nav cards, back buttons, ScreenHeader's
  // back arrow) goes through this one function, so guarding it here
  // covers all of them without touching each screen individually.
  const navigate = useCallback(
    async (name, params = {}) => {
      if (inFlight) {
        const ok = await confirmAndAbandon();
        if (!ok) return;
      }
      setScreenParams(params);
      setScreen(name);
    },
    [inFlight, confirmAndAbandon],
  );
  const goHome = () => navigate('home');

  const handleQuizGenerated = (newQuiz, usedDifficulty) => {
    setQuiz(newQuiz);
    setDifficulty(usedDifficulty);
    setCurrentIndex(0);
    navigate('quiz');
  };

  const handleFinish = (finishedQuiz) => {
    setQuiz(finishedQuiz);
    navigate('score');
  };

  const handleScanned = (filename) => {
    setUploadDraft((d) => ({
      ...d,
      existingSelected: d.existingSelected.includes(filename) ? d.existingSelected : [...d.existingSelected, filename],
    }));
    navigate('upload');
  };

  const resumeQuiz = (entry) => {
    const firstUnanswered = entry.questions.findIndex((q) => q.yourAnswer === null);
    setQuiz(entry);
    setDifficulty('medium');
    setCurrentIndex(firstUnanswered === -1 ? 0 : firstUnanswered);
    navigate('quiz');
  };

  switch (screen) {
    case 'upload':
      return (
        <UploadScreen
          navigate={navigate}
          goHome={goHome}
          uploadDraft={uploadDraft}
          setUploadDraft={setUploadDraft}
          onQuizGenerated={handleQuizGenerated}
          beginOperation={beginOperation}
          endOperation={endOperation}
        />
      );
    case 'savedPdfs':
      return (
        <SavedPdfsScreen goBack={() => navigate('upload')} uploadDraft={uploadDraft} setUploadDraft={setUploadDraft} />
      );
    case 'scanCapture':
      return (
        <ScanStagingScreen
          goBack={() => navigate('upload')}
          onScanned={handleScanned}
          beginOperation={beginOperation}
          endOperation={endOperation}
        />
      );
    case 'quiz':
      return (
        <QuizScreen
          quiz={quiz}
          setQuiz={setQuiz}
          currentIndex={currentIndex}
          setCurrentIndex={setCurrentIndex}
          difficulty={difficulty}
          goHome={goHome}
          onFinish={handleFinish}
        />
      );
    case 'score':
      return <ScoreScreen quiz={quiz} navigate={navigate} goHome={goHome} />;
    case 'reviewMissed':
      return <ReviewMissedScreen quiz={quiz} goBack={() => navigate('score')} />;
    case 'history':
      return <HistoryScreen navigate={navigate} goHome={goHome} />;
    case 'historyDetail':
      return <HistoryDetailScreen historyId={screenParams.id} goBack={() => navigate('history')} resumeQuiz={resumeQuiz} />;
    case 'weakSpots':
      return <WeakSpotsScreen goHome={goHome} />;
    case 'analytics':
      return <AnalyticsScreen goHome={goHome} />;
    case 'home':
    default:
      return <HomeScreen navigate={navigate} />;
  }
}

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));

  if (!authed) {
    return <PasswordGate onSuccess={() => setAuthed(true)} />;
  }

  return (
    <ModalProvider>
      <AppShell key="authed" />
    </ModalProvider>
  );
}

// Exposed for screens that want to force a re-login after a 401 clears the
// stored token (apiFetch already clears it; screens just need to reload).
export function forceLogout() {
  clearToken();
  window.location.reload();
}
