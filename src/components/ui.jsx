export function PrimaryButton({ title, onClick, disabled, loading, style }) {
  return (
    <button
      type="button"
      className="btn btn-primary"
      style={style}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? <span className="spinner" style={{ borderTopColor: '#fff', width: 20, height: 20 }} /> : title}
    </button>
  );
}

export function SecondaryButton({ title, onClick, disabled, style }) {
  return (
    <button type="button" className="btn btn-secondary" style={style} onClick={onClick} disabled={disabled}>
      {title}
    </button>
  );
}

export function ScreenHeader({ title, onBack, subtitle }) {
  return (
    <div className="header-row">
      {onBack ? (
        <button type="button" className="back-button" onClick={onBack}>
          ‹ Back
        </button>
      ) : (
        <div className="back-button" />
      )}
      <div style={{ flex: 1 }}>
        <h1 className="header-title">{title}</h1>
        {subtitle ? <p className="header-subtitle">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="error-banner">{message}</div>;
}

export function LoadingView({ label = 'Loading...' }) {
  return (
    <div className="center-fill">
      <div className="spinner" />
      <p className="subtext" style={{ marginTop: 12 }}>
        {label}
      </p>
    </div>
  );
}

export function Bar({ fraction, color }) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch (e) {
    return iso;
  }
}

export function formatPercent(fraction) {
  if (fraction === null || fraction === undefined) return '--';
  return `${Math.round(fraction * 100)}%`;
}
