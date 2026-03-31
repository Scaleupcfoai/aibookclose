import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AuthPage from './components/AuthPage.jsx'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'

function Root() {
  const { isAuthenticated, loading, needsFirmRegistration } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', color: '#5e6c84' }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated || needsFirmRegistration) {
    return <AuthPage />;
  }

  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </StrictMode>,
)
