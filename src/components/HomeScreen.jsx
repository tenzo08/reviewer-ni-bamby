export default function HomeScreen({ navigate }) {
  return (
    <div className="screen">
      <h1 className="app-title">Reviewer ni Bambyy</h1>
      <p className="app-subtitle">Turn a PDF module into a quiz.</p>

      <div className="grid">
        <button type="button" className="grid-card" onClick={() => navigate('upload')}>
          <span className="grid-card-emoji">📄</span>
          <span className="grid-card-label">New Quiz</span>
        </button>
        <button type="button" className="grid-card" onClick={() => navigate('history')}>
          <span className="grid-card-emoji">🕘</span>
          <span className="grid-card-label">History</span>
        </button>
        <button type="button" className="grid-card" onClick={() => navigate('weakSpots')}>
          <span className="grid-card-emoji">🎯</span>
          <span className="grid-card-label">Weak Spots</span>
        </button>
        <button type="button" className="grid-card" onClick={() => navigate('analytics')}>
          <span className="grid-card-emoji">📊</span>
          <span className="grid-card-label">Analytics</span>
        </button>
      </div>
    </div>
  );
}
