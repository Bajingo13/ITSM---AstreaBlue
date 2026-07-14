import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  getSavedUser,
  getAuthToken,
  hasStaleSavedUser,
  loginUser,
  logoutUser,
  saveUser,
} from "./AuthService";
import { API_URL } from "../config/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = getSavedUser();
    if (!savedUser && hasStaleSavedUser()) {
      logoutUser();
    }
    if (savedUser) setUser(savedUser);
    setLoading(false);
  }, []);

  const login = async (email, password, rememberMe) => {
    const data = await loginUser(email, password);

    const loggedUser = {
      user_id:       data.user?.user_id,
      full_name:     data.user?.full_name,
      email:         data.user?.email,
      role_name:     data.user?.role_name,
      company_name:  data.user?.company_name,
      branch_id:     data.user?.branch_id,
      branch_name:   data.user?.branch_name,
      mobile_number: data.user?.mobile_number,
      is_active:     data.user?.is_active,
      onboarding_status: data.user?.onboarding_status,
      onboarding_required: data.user?.onboarding_required,
      onboarding_completed_at: data.user?.onboarding_completed_at,
      onboarding_consent_id: data.user?.onboarding_consent_id,
      must_complete_onboarding: data.user?.must_complete_onboarding,
    };

    // data.token is the JWT returned from the updated login route
    saveUser(loggedUser, data.token || null, rememberMe);
    setUser(loggedUser);
    return loggedUser;
  };

  const logout = () => {
    logoutUser();
    setUser(null);
  };

  const refreshOnboarding = useCallback(async () => {
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/api/v1/onboarding/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Failed to refresh onboarding status.");
    setUser((currentUser) => {
      const nextUser = {
        ...currentUser,
        onboarding_status: payload.data.onboarding_status,
        onboarding_required: payload.data.onboarding_required,
        onboarding_completed_at: payload.data.onboarding_completed_at,
        onboarding_consent_id: payload.data.onboarding_consent_id,
        must_complete_onboarding: payload.data.must_complete_onboarding,
      };
      saveUser(nextUser, token, Boolean(localStorage.getItem("user")));
      return nextUser;
    });
    return payload.data;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role_name || user?.role || null,
        loading,
        login,
        logout,
        refreshOnboarding,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
