import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sun, Moon, Sunrise, Eye, EyeOff, Loader2, Mail, Lock, ArrowRight, ShieldCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

function getTimeOfDay(hour: number) {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

const themes = {
  morning: {
    greeting: "Good Morning",
    subtitle: "Ready to start your day?",
    bg: "bg-gradient-to-br from-[#123047] via-[#1a4a6b] to-[#1f97d4]",
    accentText: "text-amber-300",
    iconColor: "text-amber-300",
    Icon: Sunrise,
    buttonClass: "bg-[#009972] hover:bg-[#008563] shadow-[0_4px_12px_rgba(0,153,114,0.35)]",
  },
  afternoon: {
    greeting: "Good Afternoon",
    subtitle: "Welcome back",
    bg: "bg-gradient-to-br from-[#123047] via-[#163d5a] to-[#1f97d4]",
    accentText: "text-[#65bbd0]",
    iconColor: "text-[#65bbd0]",
    Icon: Sun,
    buttonClass: "bg-[#009972] hover:bg-[#008563] shadow-[0_4px_12px_rgba(0,153,114,0.35)]",
  },
  evening: {
    greeting: "Good Evening",
    subtitle: "Starting your shift?",
    bg: "bg-gradient-to-br from-[#0b1e2f] via-[#123047] to-[#163d5a]",
    accentText: "text-indigo-300",
    iconColor: "text-indigo-300",
    Icon: Moon,
    buttonClass: "bg-[#1f97d4] hover:bg-[#1a82b8] shadow-[0_4px_12px_rgba(31,151,212,0.35)]",
  },
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [time, setTime] = useState(new Date());
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
  const tod = getTimeOfDay(time.getHours());
  const theme = themes[tod];
  const TimeIcon = theme.Icon;

  const timeString = time.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const dateString = time.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className={`min-h-screen flex flex-col ${theme.bg} transition-colors duration-1000`} data-testid="login-page">
      <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto relative py-10 px-6">
        <div className="absolute inset-0 opacity-[0.03]" aria-hidden="true" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="relative z-10 w-full max-w-[400px] mx-auto">
          <div className="text-center mb-8">
            <TimeIcon className={`h-7 w-7 mx-auto mb-3 ${theme.iconColor}`} aria-hidden="true" />

            <p className="text-4xl font-light text-white tracking-tight tabular-nums" data-testid="text-clock">
              {timeString}
            </p>
            <p className="text-xs text-white/50 font-medium uppercase tracking-[0.2em] mt-1.5">
              {dateString}
            </p>

            <div className="w-10 h-px bg-white/20 mx-auto my-5" aria-hidden="true" />

            <h1 className={`text-xl font-semibold ${theme.accentText}`} data-testid="text-greeting">
              {theme.greeting}
            </h1>
            <p className="text-sm text-white/50 mt-1" data-testid="text-subtitle">
              {theme.subtitle}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] p-7">
            <div className="flex flex-col items-center mb-6">
              <div className="bg-white rounded-xl p-2 shadow-sm border border-gray-100 mb-2.5">
                <img
                  src="/ahava-logo.jpg"
                  alt="Ahava Medical Center"
                  className="h-10 w-auto object-contain"
                  data-testid="img-logo"
                />
              </div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em]" data-testid="text-title">
                Ahava Medical Center
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-[#123047] font-medium text-[12px] tracking-wide uppercase">
                    Email
                  </Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-4 w-4 text-[#b3dbdd]" aria-hidden="true" />
                    </div>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@ahavamedical.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      aria-invalid={hasError || undefined}
                      aria-describedby={hasError ? "login-error" : undefined}
                      data-testid="input-email"
                      className="pl-10 h-11 text-sm border-gray-200 bg-gray-50/70 rounded-lg focus:border-[#1f97d4] focus:ring-1 focus:ring-[#1f97d4] focus:bg-white transition-colors placeholder:text-gray-400"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-[#123047] font-medium text-[12px] tracking-wide uppercase">
                    Password
                  </Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="h-4 w-4 text-[#b3dbdd]" aria-hidden="true" />
                    </div>
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      aria-invalid={hasError || undefined}
                      aria-describedby={hasError ? "login-error" : undefined}
                      data-testid="input-password"
                      className="pl-10 pr-10 h-11 text-sm border-gray-200 bg-gray-50/70 rounded-lg focus:border-[#1f97d4] focus:ring-1 focus:ring-[#1f97d4] focus:bg-white transition-colors placeholder:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-password"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div
                  id="login-error"
                  role="alert"
                  aria-live="polite"
                  className="bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5 flex items-center gap-2"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" aria-hidden="true" />
                  <p className="text-sm text-red-600 font-medium" data-testid="text-error">
                    {error}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loginMutation.isPending}
                data-testid="button-login"
                className={`w-full h-11 text-sm font-semibold text-white rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${theme.buttonClass}`}
              >
                {loginMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </Button>

              <div className="text-center">
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-[#123047]/70 hover:text-[#123047] hover:underline"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </Link>
              </div>
            </form>
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-7 text-white/40">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-[11px] font-medium tracking-wider uppercase">
              Authorized personnel only
            </span>
          </div>
        </div>
      </div>

      <div className="relative z-10 bg-black/20 py-2.5 text-center">
        <p className="text-[11px] text-white/35" data-testid="text-copyright">
          &copy; {new Date().getFullYear()} Ahava Medical Center
        </p>
      </div>
    </div>
  );
}
