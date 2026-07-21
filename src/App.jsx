import { useState } from 'react';
import { getToken, clearToken } from './lib/apiClient.js';
import { ModalProvider } from './components/Modals.jsx';
import PasswordGate from './components/PasswordGate.jsx';
import HomeScreen from './components/HomeScreen.jsx';
import UploadScreen from './components/UploadScreen.jsx';
import SavedPdfsScreen from './components/SavedPdfsScreen.jsx';
import ScanCaptureScreen from './components/ScanCaptureScreen.jsx';
import QuizScreen from './components/QuizScreen.jsx';
import ScoreScreen from './components/ScoreScreen.jsx';
import ReviewMissedScreen from './components/ReviewMissedScreen.jsx';
import HistoryScreen from './components/HistoryScreen.jsx';
import HistoryDetailScreen from './components/HistoryDetailScreen.jsx';
import WeakSpotsScreen from './components/WeakSpotsScreen.jsx';
import AnalyticsScreen from './components/AnalyticsScreen.jsx';

const emptyUploadDraft = { newFiles: [], existingSelected: [], numQuestions: 5, difficulty: 'medium' };

function AppShell() {
  const [screen, setScreen] = useState('home');
  const [screenParams, setScreenParams] = useState({});
  const [uploadDraft, setUploadDraft] = useState(emptyUploadDraft);
  const [quiz, setQuiz] = useState(null);
  const [difficulty, setDifficulty] = useState('medium');
  const [currentIndex, setCurrentIndex] = useState(0);

  const navigate = (name, params = {}) => {
    setScreenParams(params);
    setScreen(name);
  };
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
        />
      );
    case 'savedPdfs':
      return (
        <SavedPdfsScreen goBack={() => navigate('upload')} uploadDraft={uploadDraft} setUploadDraft={setUploadDraft} />
      );
    case 'scanCapture':
      return <ScanCaptureScreen goBack={() => navigate('upload')} onScanned={handleScanned} />;
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
