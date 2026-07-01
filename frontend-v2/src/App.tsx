import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import HomePage from "./pages/HomePage";
import ReportLibraryPage from "./pages/ReportLibraryPage";
import ReportDetailPage from "./pages/ReportDetailPage";
import CollectionDashboard from "./pages/CollectionDashboard";
import ChatPage from "./pages/ChatPage";
import EmailSettingsPage from "./pages/EmailSettingsPage";
import LoginPage from "./pages/LoginPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { email, isReady } = useAuth();
  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!email) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Nav() {
  const { email, logout } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? "bg-indigo-100 text-indigo-700"
        : "text-gray-600 hover:bg-gray-100"
    }`;

  return (
    <nav className="border-b border-gray-200 bg-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-2">
        <span className="font-bold text-lg text-gray-900 mr-6">ResearchAgent</span>
        <NavLink to="/" className={link} end>
          收集研报
        </NavLink>
        <NavLink to="/library" className={link}>
          研报库
        </NavLink>
        <NavLink to="/tasks" className={link}>
          任务监控
        </NavLink>
        <NavLink to="/chat" className={link}>
          智能问答
        </NavLink>
        <NavLink to="/email" className={link}>
          邮件推送
        </NavLink>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400">{email}</span>
          <button
            onClick={logout}
            className="text-xs text-gray-500 hover:text-red-600 transition-colors"
          >
            退出
          </button>
        </div>
      </div>
    </nav>
  );
}

function AppLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<ReportLibraryPage />} />
          <Route path="/library/:id" element={<ReportDetailPage />} />
          <Route path="/tasks" element={<CollectionDashboard />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/email" element={<EmailSettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
