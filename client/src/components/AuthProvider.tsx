import { createContext, useContext, useState, useEffect } from "react";
import type { User } from "@shared/schema";
import { safeGet, safeSet, safeRemove } from "@/lib/storage";

interface AuthCtx {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  updateUser: (partial: Partial<User>) => void;
}

const AUTH_KEY = "viewrr_session_user";
const SESSION_VERSION = "v4"; // bump this to force-clear all stored sessions
const VERSION_KEY = "viewrr_session_version";

const AuthContext = createContext<AuthCtx>({ user: null, login: () => {}, logout: () => {}, updateUser: () => {} });

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

  // PRD-019: Validate session against server on mount.
  // If the server-side session is expired or revoked, clear localStorage and sign out.
  useEffect(() => {
    // Only validate if we have a locally stored user (i.e. think we're logged in)
    const storedUser = loadStoredUser();
    if (!storedUser) return;

    fetch("/api/auth/me", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) {
          // Server-side session is gone — clear local state
          setUser(null);
          safeRemove(AUTH_KEY);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data?.user) {
            // Refresh local user object from server (role/name may have changed)
            const refreshed = { ...storedUser, ...data.user };
            setUser(refreshed);
            try { safeSet(AUTH_KEY, JSON.stringify(refreshed)); } catch {}
          }
        }
      })
      .catch(() => {
        // Network error — keep existing user; don't sign out (offline tolerance)
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function login(u: User) {
    setUser(u);
    try { safeSet(AUTH_KEY, JSON.stringify(u)); } catch {}
  }

  function logout() {
    setUser(null);
    safeRemove(AUTH_KEY);
    // PRD-019: Tell the server to revoke the DB session (cookie or Bearer)
    fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
  }

  function updateUser(partial: Partial<User>) {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      try { safeSet(AUTH_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
