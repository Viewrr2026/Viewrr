import { createContext, useContext, useState } from "react";
import type { User } from "@shared/schema";
import { safeGet, safeSet, safeRemove } from "@/lib/storage";

interface AuthCtx {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
}

const AUTH_KEY = "viewrr_session_user";
const SESSION_VERSION = "v4"; // bump this to force-clear all stored sessions
const VERSION_KEY = "viewrr_session_version";

const AuthContext = createContext<AuthCtx>({ user: null, login: () => {}, logout: () => {} });

function loadStoredUser(): User | null {
  try {
    // If the stored version doesn't match, wipe everything and start fresh
    const storedVersion = safeGet(VERSION_KEY);
    if (storedVersion !== SESSION_VERSION) {
      safeRemove(AUTH_KEY);
      safeSet(VERSION_KEY, SESSION_VERSION);
      return null;
    }
    const raw = safeGet(AUTH_KEY);
    if (!raw || raw === "" || raw === "null") return null;
    const parsed = JSON.parse(raw);
    // Validate it looks like a real user object
    if (parsed && typeof parsed === "object" && parsed.id && parsed.email && parsed.role) {
      return parsed as User;
    }
    return null;
  } catch {
    // Corrupted — wipe it
    safeRemove(AUTH_KEY);
    safeRemove(VERSION_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(loadStoredUser);

  function login(u: User) {
    setUser(u);
    try { safeSet(AUTH_KEY, JSON.stringify(u)); } catch {}
  }

  function logout() {
    setUser(null);
    safeRemove(AUTH_KEY);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
