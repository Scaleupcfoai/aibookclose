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
  const [user, setUser] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsFirmRegistration, setNeedsFirmRegistration] = useState(false);

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
      setNeedsFirmRegistration(false);
    }
  }

  async function fetchUserProfile() {
    try {
      const me = await api.get(ENDPOINTS.authMe);
      setUser(me);
      if (!me.firm_id) {
        setNeedsFirmRegistration(true);
        return;
      }
      setNeedsFirmRegistration(false);
      try {
        const comps = await api.get(ENDPOINTS.companies);
        setCompanies(comps || []);
        if (comps?.length > 0 && !selectedCompany) {
          setSelectedCompany(comps[0]);
        }
      } catch {
        setCompanies([]);
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
      // Refresh the Supabase session to get updated JWT with firm_id
      const { data: refreshData } = await supabase.auth.refreshSession();
      if (refreshData?.session) {
        setAuthToken(refreshData.session.access_token);
        setSession(refreshData.session);
      }
      setNeedsFirmRegistration(false);
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
    setNeedsFirmRegistration(false);
  }

  async function refreshCompanies() {
    try {
      const comps = await api.get(ENDPOINTS.companies);
      setCompanies(comps || []);
      if (comps?.length > 0 && !selectedCompany) {
        setSelectedCompany(comps[0]);
      }
      return comps;
    } catch {
      return [];
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
    needsFirmRegistration,
    signUp,
    signIn,
    signOut,
    registerFirm,
    refreshCompanies,
    isAuthenticated: !!session,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
