import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { setAuthToken, api } from '../services/api';
import { ENDPOINTS } from '../config';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);       // { user_id, email, firm_id, role }
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // On mount: check for existing session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      handleSession(s);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      handleSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  function handleSession(s) {
    setSession(s);
    if (s?.access_token) {
      setAuthToken(s.access_token);
      fetchUserProfile();
    } else {
      setAuthToken(null);
      setUser(null);
      setCompanies([]);
      setSelectedCompany(null);
    }
  }

  async function fetchUserProfile() {
    try {
      const me = await api.get(ENDPOINTS.authMe);
      setUser(me);
      // Once we have user, fetch companies
      const comps = await api.get(ENDPOINTS.companies);
      setCompanies(comps || []);
      if (comps?.length > 0 && !selectedCompany) {
        setSelectedCompany(comps[0]);
      }
    } catch (err) {
      console.warn('[Auth] Could not fetch profile:', err.message);
    }
  }

  async function signUp(email, password) {
    setError(null);
    const { data, error: authErr } = await supabase.auth.signUp({ email, password });
    if (authErr) { setError(authErr.message); return null; }
    return data;
  }

  async function registerFirm(firmName, firmPan, firmAddress) {
    setError(null);
    try {
      const result = await api.post(ENDPOINTS.registerFirm, {
        firm_name: firmName,
        firm_pan: firmPan || '',
        firm_address: firmAddress || '',
      });
      // Refresh user profile to get firm_id
      await fetchUserProfile();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  async function signIn(email, password) {
    setError(null);
    const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) { setError(authErr.message); return null; }
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setAuthToken(null);
    setCompanies([]);
    setSelectedCompany(null);
  }

  async function createCompany(companyData) {
    setError(null);
    try {
      const result = await api.post(ENDPOINTS.companies, companyData);
      // Refresh companies list
      const comps = await api.get(ENDPOINTS.companies);
      setCompanies(comps || []);
      if (!selectedCompany && comps?.length > 0) {
        setSelectedCompany(comps[0]);
      }
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  const value = {
    session,
    user,
    companies,
    selectedCompany,
    setSelectedCompany,
    loading,
    error,
    signUp,
    signIn,
    signOut,
    registerFirm,
    createCompany,
    isAuthenticated: !!session,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
