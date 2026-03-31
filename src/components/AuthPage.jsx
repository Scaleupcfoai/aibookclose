import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

function AuthPage() {
  const { signUp, signIn, registerFirm, error } = useAuth();
  const [mode, setMode] = useState('login'); // login | signup | register-firm
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firmName, setFirmName] = useState('');
  const [firmPan, setFirmPan] = useState('');
  const [firmAddress, setFirmAddress] = useState('');
  const [localMsg, setLocalMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalMsg('');
    const result = await signIn(email, password);
    setSubmitting(false);
    if (!result) setLocalMsg('Login failed. Check your credentials.');
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalMsg('');
    const result = await signUp(email, password);
    setSubmitting(false);
    if (result) {
      setLocalMsg('Account created. Now register your CA firm.');
      setMode('register-firm');
    }
  };

  const handleRegisterFirm = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalMsg('');
    const result = await registerFirm(firmName, firmPan, firmAddress);
    setSubmitting(false);
    if (result) {
      setLocalMsg('Firm registered! Redirecting...');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">L</div>
        <h1 className="auth-title">Lekha AI</h1>
        <p className="auth-subtitle">TDS Reconciliation Platform</p>

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="auth-form">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="auth-input"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="auth-input"
              required
            />
            <button type="submit" className="auth-btn" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
            <p className="auth-switch">
              No account?{' '}
              <button type="button" onClick={() => { setMode('signup'); setLocalMsg(''); }}>
                Sign Up
              </button>
            </p>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignup} className="auth-form">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="auth-input"
              required
            />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="auth-input"
              required
              minLength={6}
            />
            <button type="submit" className="auth-btn" disabled={submitting}>
              {submitting ? 'Creating account...' : 'Create Account'}
            </button>
            <p className="auth-switch">
              Already have an account?{' '}
              <button type="button" onClick={() => { setMode('login'); setLocalMsg(''); }}>
                Sign In
              </button>
            </p>
          </form>
        )}

        {mode === 'register-firm' && (
          <form onSubmit={handleRegisterFirm} className="auth-form">
            <p className="auth-firm-intro">Register your CA firm to get started</p>
            <input
              type="text"
              placeholder="Firm name (e.g. ScaleUp CFO)"
              value={firmName}
              onChange={e => setFirmName(e.target.value)}
              className="auth-input"
              required
            />
            <input
              type="text"
              placeholder="Firm PAN (optional)"
              value={firmPan}
              onChange={e => setFirmPan(e.target.value)}
              className="auth-input"
            />
            <input
              type="text"
              placeholder="Firm address (optional)"
              value={firmAddress}
              onChange={e => setFirmAddress(e.target.value)}
              className="auth-input"
            />
            <button type="submit" className="auth-btn" disabled={submitting}>
              {submitting ? 'Registering...' : 'Register Firm'}
            </button>
          </form>
        )}

        {(error || localMsg) && (
          <div className={`auth-message ${error ? 'error' : ''}`}>
            {error || localMsg}
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthPage;
