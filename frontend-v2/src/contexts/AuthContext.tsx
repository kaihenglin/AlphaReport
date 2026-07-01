import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

const EMAIL_KEY = "alphareport.email";

interface AuthState {
  email: string | null;
  isReady: boolean;
}

type AuthAction =
  | { type: "RESTORE"; email: string }
  | { type: "LOGIN"; email: string }
  | { type: "LOGOUT" };

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "RESTORE":
      return { email: action.email, isReady: true };
    case "LOGIN":
      return { email: action.email, isReady: true };
    case "LOGOUT":
      return { email: null, isReady: true };
    default:
      return state;
  }
}

interface AuthContextValue {
  email: string | null;
  isReady: boolean;
  login: (email: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    email: null,
    isReady: false,
  });

  // Restore email from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(EMAIL_KEY);
    if (saved) {
      dispatch({ type: "RESTORE", email: saved });
    } else {
      dispatch({ type: "LOGOUT" });
    }
  }, []);

  const login = useCallback((email: string) => {
    const trimmed = email.trim().toLowerCase();
    localStorage.setItem(EMAIL_KEY, trimmed);
    dispatch({ type: "LOGIN", email: trimmed });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(EMAIL_KEY);
    dispatch({ type: "LOGOUT" });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
