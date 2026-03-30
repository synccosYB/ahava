import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Sun, Moon, Sunrise, Eye, EyeOff, Loader2 } from "lucide-react";

export function ShiftAware() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const hour = time.getHours();

  // Determine time of day based on hours
  // Morning (5-11), Afternoon (12-16), Evening/Night (17-4)
  let timeOfDay = "night";
  if (hour >= 5 && hour < 12) {
    timeOfDay = "morning";
  } else if (hour >= 12 && hour < 17) {
    timeOfDay = "afternoon";
  } else {
    timeOfDay = "night";
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password");
      return;
    }
    setError("");
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      // Success simulation
    }, 1500);
  };

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

  // Dynamic themes based on time of day
  const themes = {
    morning: {
      greeting: "Good Morning",
      icon: <Sunrise className="h-8 w-8 text-amber-500 mb-2" aria-hidden="true" />,
      bgClass: "bg-gradient-to-br from-amber-50 via-slate-50 to-[#b3dbdd]",
      textAccent: "text-amber-600",
      cardBorder: "border-amber-100",
      buttonBg: "bg-[#123047] hover:bg-[#123047]/90",
    },
    afternoon: {
      greeting: "Good Afternoon",
      icon: <Sun className="h-8 w-8 text-[#1f97d4] mb-2" aria-hidden="true" />,
      bgClass: "bg-gradient-to-br from-[#f0f9ff] via-white to-[#e0f2fe]",
      textAccent: "text-[#1f97d4]",
      cardBorder: "border-sky-100",
      buttonBg: "bg-[#009972] hover:bg-[#009972]/90",
    },
    night: {
      greeting: "Good Evening",
      icon: <Moon className="h-8 w-8 text-indigo-400 mb-2" aria-hidden="true" />,
      bgClass: "bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#123047]",
      textAccent: "text-indigo-300",
      cardBorder: "border-slate-700/50",
      buttonBg: "bg-[#1f97d4] hover:bg-[#1f97d4]/90",
      isDark: true,
    },
  };

  const currentTheme = themes[timeOfDay as keyof typeof themes];
  const isDark = "isDark" in currentTheme && currentTheme.isDark;

  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-1000 ${currentTheme.bgClass} ${
        isDark ? "dark text-slate-100" : "text-slate-900"
      }`}
    >
      <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        
        {/* Time & Greeting Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          {currentTheme.icon}
          <h1 className="text-4xl md:text-5xl font-light tracking-tight">
            {timeString}
          </h1>
          <p className={`text-sm font-medium uppercase tracking-widest ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            {dateString}
          </p>
          <div className="h-px w-16 bg-current opacity-20 my-4" />
          <h2 className={`text-2xl font-semibold ${currentTheme.textAccent}`}>
            {currentTheme.greeting}
          </h2>
          <p className={isDark ? "text-slate-400" : "text-slate-600"}>
            Ready for your shift?
          </p>
        </div>

        {/* Brand & Form Card */}
        <Card className={`backdrop-blur-sm bg-white/95 shadow-xl ${currentTheme.cardBorder} ${isDark ? "bg-slate-900/95 border-slate-700" : ""}`}>
          <CardContent className="pt-8 pb-8 px-6 sm:px-8">
            
            {/* Logo */}
            <div className="flex flex-col items-center justify-center mb-8">
              <div className="bg-white p-2 rounded-lg mb-3 shadow-sm">
                <img
                  src="/__mockup/images/ahava-logo.jpg"
                  alt="Ahava Medical Center Logo"
                  className="h-10 w-auto object-contain"
                />
              </div>
              <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-300" : "text-slate-500"}`}>
                Ahava Medical Center
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div 
                role="alert" 
                className="mb-6 p-3 rounded-md bg-red-50 text-red-600 border border-red-200 text-sm flex items-center"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-red-600 mr-2" />
                {error}
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className={isDark ? "text-slate-200" : ""}>
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@ahavamedical.com"
                  data-testid="email-input"
                  className={`h-11 ${isDark ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500" : "focus-visible:ring-[#1f97d4]"}`}
                  autoComplete="email"
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className={isDark ? "text-slate-200" : ""}>
                    Password
                  </Label>
                  <a
                    href="#"
                    className={`text-sm font-medium hover:underline ${isDark ? "text-indigo-400" : "text-[#1f97d4]"}`}
                  >
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    data-testid="password-input"
                    className={`h-11 pr-10 ${isDark ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500" : "focus-visible:ring-[#1f97d4]"}`}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors ${
                      isDark ? "text-slate-400 hover:text-slate-200" : "text-slate-400 hover:text-slate-600"
                    }`}
                    data-testid="toggle-password"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="sr-only">
                      {showPassword ? "Hide password" : "Show password"}
                    </span>
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className={`w-full h-11 text-base font-medium transition-all shadow-md mt-2 ${currentTheme.buttonBg} text-white`}
                data-testid="submit-button"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center pb-8">
          <p className={`text-xs uppercase tracking-widest ${isDark ? "text-slate-500" : "text-slate-400"}`}>
            Authorized Personnel Only
          </p>
        </div>

      </div>
    </div>
  );
}

export default ShiftAware;
