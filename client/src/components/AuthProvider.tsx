import { createContext, useContext, useState, useEffect } from "react";
import type { User } from "@shared/schema";
import { safeGet, safeSet } from "@/lib/storage";

interface AuthCtx {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
}

const AUTH_KEY = "viewrr_session_user";

const AuthContext = createContext<AuthCtx>({ user: null, login: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Restore session from localStorage on first load
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = safeGet(AUTH_KEY);
      if (stored) return JSON.parse(stored) as User;
    } catch {}
    return null;
  });

  function login(u: User) {
    setUser(u);
    try { safeSet(AUTH_KEY, JSON.stringify(u)); } catch {}
  }

  function logout() {
    setUser(null);
    try { safeSet(AUTH_KEY, ""); } catch {}
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
