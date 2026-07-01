import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const { email: authEmail, login, isReady } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
  useEffect(() => {
    if (isReady && authEmail) {
      navigate("/", { replace: true });
    }
  }, [isReady, authEmail, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setError("");
    login(trimmed);
    navigate("/", { replace: true });
  };

  // Loading state
  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Already authenticated — show nothing while redirecting
  if (authEmail) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50">
      <Card className="w-full max-w-md mx-4 shadow-lg">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold text-indigo-900">
            AlphaReport
          </CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            输入邮箱进入系统，自动创建独立账号
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">
                邮箱地址
              </label>
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                className="mt-1"
                autoFocus
              />
              {error && (
                <p className="text-sm text-red-500 mt-1">{error}</p>
              )}
            </div>
            <Button type="submit" className="w-full" size="lg">
              进入系统
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
