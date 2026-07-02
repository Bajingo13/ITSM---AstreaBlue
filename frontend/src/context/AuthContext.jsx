import React, { createContext, useContext, useEffect, useState } from "react";
import {
  getSavedUser,
  hasStaleSavedUser,
  loginUser,
  logoutUser,
  saveUser,
} from "./AuthService";

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

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role_name || user?.role || null,
        loading,
        login,
        logout,
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
