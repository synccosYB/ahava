import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail, ArrowRight, ShieldCheck, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Login failed");
      }
      return res.json();
    },
    onSuccess: (userData) => {
      setError("");
      queryClient.setQueryData(["/api/auth/user"], userData);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMutation.mutate();
  };

  const hasError = error.length > 0;

  return (
    <div className="min-h-screen flex flex-col" data-testid="login-page">
      <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto relative py-12 px-6">
        <div className="absolute inset-0 bg-gradient-to-br from-[#123047] via-[#163d5a] to-[#1f97d4]" aria-hidden="true" />

        <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-black/10 to-transparent" aria-hidden="true" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black/15 to-transparent" aria-hidden="true" />

        <div className="relative z-10 w-full max-w-[420px] mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center bg-white rounded-2xl p-3 shadow-[0_8px_30px_rgba(0,0,0,0.2)] mb-7">
              <img
                src="/ahava-logo.jpg"
                alt="Ahava Medical Center"
                className="h-16 w-auto object-contain"
                data-testid="img-logo"
              />
            </div>

            <h1 className="text-[1.65rem] font-bold text-white tracking-tight leading-tight" data-testid="text-title">
              Ahava Medical Center
            </h1>
            <p className="text-sm text-white/75 font-medium tracking-widest uppercase mt-2" data-testid="text-subtitle">
              Time & Attendance
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.25)] p-8">
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-[#123047] font-medium text-[13px] tracking-wide uppercase">
                    Email
                  </Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <Mail className="h-[18px] w-[18px] text-[#b3dbdd]" aria-hidden="true" />
                    </div>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@ahavamedical.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      aria-invalid={hasError || undefined}
                      aria-describedby={hasError ? "login-error" : undefined}
                      data-testid="input-email"
                      className="pl-11 h-12 text-[15px] border-gray-200 bg-[#f9fafb] rounded-xl focus:border-[#1f97d4] focus:ring-1 focus:ring-[#1f97d4] focus:bg-white transition-colors placeholder:text-gray-400"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-[#123047] font-medium text-[13px] tracking-wide uppercase">
                    Password
                  </Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <Lock className="h-[18px] w-[18px] text-[#b3dbdd]" aria-hidden="true" />
                    </div>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      aria-invalid={hasError || undefined}
                      aria-describedby={hasError ? "login-error" : undefined}
                      data-testid="input-password"
                      className="pl-11 h-12 text-[15px] border-gray-200 bg-[#f9fafb] rounded-xl focus:border-[#1f97d4] focus:ring-1 focus:ring-[#1f97d4] focus:bg-white transition-colors placeholder:text-gray-400"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div
                  id="login-error"
                  role="alert"
                  aria-live="polite"
                  className="bg-red-50 border border-red-100 rounded-lg px-4 py-2.5"
                >
                  <p className="text-sm text-red-600 text-center font-medium" data-testid="text-error">
                    {error}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loginMutation.isPending}
                data-testid="button-login"
                className="w-full h-12 text-[15px] font-semibold bg-[#009972] hover:bg-[#008563] text-white rounded-xl shadow-[0_4px_12px_rgba(0,153,114,0.3)] hover:shadow-[0_6px_20px_rgba(0,153,114,0.4)] transition-all duration-200 flex items-center justify-center gap-2"
              >
                {loginMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </Button>
            </form>
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-8 text-white/55">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs font-medium tracking-wide">
              Authorized personnel only
            </span>
          </div>
        </div>
      </div>

      <div className="relative z-10 bg-[#0e2436] py-3 text-center">
        <p className="text-xs text-white/50" data-testid="text-copyright">
          &copy; {new Date().getFullYear()} Ahava Medical Center
        </p>
      </div>
    </div>
  );
}
