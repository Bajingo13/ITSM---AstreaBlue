import React, { createContext, useContext, useEffect, useState } from "react";
import { getSavedUser, loginUser, logoutUser, saveUser } from "./AuthService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = getSavedUser();
    if (savedUser) {
      setUser(savedUser);
    }
    setLoading(false);
  }, []);

  const login = async (email, password, rememberMe) => {
    const data = await loginUser(email, password);

    const loggedUser = data.user;

    saveUser(loggedUser, rememberMe);
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