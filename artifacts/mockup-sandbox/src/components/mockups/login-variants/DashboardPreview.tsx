import { useState } from "react";
import { 
  Building2, 
  CalendarDays, 
  Clock, 
  LayoutDashboard, 
  LogOut, 
  PieChart, 
  Settings, 
  Users,
  Eye,
  EyeOff
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DashboardPreview() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 1500);
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0a1a27]">
      
      {/* --- BACKGROUND DASHBOARD PREVIEW --- */}
      <div className="absolute inset-0 z-0 flex select-none opacity-40 blur-[6px] filter transition-all duration-1000 ease-in-out">
        
        {/* Fake Sidebar */}
        <div className="hidden w-64 flex-col border-r border-[#1f97d4]/20 bg-[#123047] p-4 lg:flex">
          <div className="mb-8 flex items-center gap-3 px-2">
            <div className="h-8 w-8 rounded-md bg-[#009972]" />
            <div className="h-5 w-32 rounded bg-white/20" />
          </div>
          <nav className="flex flex-1 flex-col gap-2">
            {[LayoutDashboard, Clock, CalendarDays, Users, PieChart, Building2, Settings].map((Icon, i) => (
              <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${i === 0 ? 'bg-[#1f97d4]/20 text-[#65bbd0]' : 'text-slate-400'}`}>
                <Icon className="h-5 w-5" />
                <div className={`h-4 rounded ${i === 0 ? 'w-24 bg-[#65bbd0]/50' : 'w-20 bg-slate-500/50'}`} />
              </div>
            ))}
          </nav>
          <div className="mt-auto flex items-center gap-3 px-3 py-2 text-slate-400">
            <LogOut className="h-5 w-5" />
            <div className="h-4 w-16 rounded bg-slate-500/50" />
          </div>
        </div>

        {/* Fake Main Content */}
        <div className="flex flex-1 flex-col overflow-hidden bg-slate-50/5 dark:bg-slate-900/50">
          {/* Fake Header */}
          <header className="flex h-16 items-center justify-between border-b border-[#1f97d4]/10 bg-white/5 px-6 dark:bg-slate-950/20">
            <div className="h-6 w-48 rounded bg-white/20" />
            <div className="flex items-center gap-4">
              <div className="h-8 w-8 rounded-full bg-white/20" />
              <div className="h-8 w-8 rounded-full bg-white/20" />
            </div>
          </header>

          {/* Fake Dashboard Grid */}
          <main className="flex-1 overflow-auto p-6">
            <div className="mb-6 h-8 w-64 rounded bg-white/20" />
            
            {/* Stats Row */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {[
                { title: "Today's Hours", val: "7.5h", color: "bg-[#1f97d4]" },
                { title: "This Week", val: "32.5h", color: "bg-[#009972]" },
                { title: "Exceptions", val: "2", color: "bg-red-500" },
                { title: "PTO Balance", val: "48h", color: "bg-[#56b9ca]" }
              ].map((stat, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-6 shadow-sm backdrop-blur-sm dark:bg-slate-950/20">
                  <div className="mb-4 flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-lg ${stat.color} opacity-80`} />
                    <div className="h-4 w-24 rounded bg-white/30" />
                  </div>
                  <div className="h-8 w-16 rounded bg-white/40" />
                </div>
              ))}
            </div>

            {/* Charts/Tables Row */}
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="col-span-2 rounded-xl border border-white/10 bg-white/5 p-6 shadow-sm backdrop-blur-sm dark:bg-slate-950/20">
                <div className="mb-6 h-6 w-40 rounded bg-white/30" />
                <div className="h-64 rounded-lg border border-white/5 bg-white/5" />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-6 shadow-sm backdrop-blur-sm dark:bg-slate-950/20">
                <div className="mb-6 h-6 w-32 rounded bg-white/30" />
                <div className="flex flex-col gap-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="flex items-center justify-between border-b border-white/5 pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-white/20" />
                        <div>
                          <div className="mb-2 h-4 w-24 rounded bg-white/30" />
                          <div className="h-3 w-16 rounded bg-white/20" />
                        </div>
                      </div>
                      <div className="h-6 w-16 rounded-full bg-[#009972]/40" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
      
      {/* Dark gradient overlay to ensure login card pops and text is readable */}
      <div className="absolute inset-0 z-10 bg-gradient-to-br from-[#123047]/80 via-[#123047]/90 to-slate-900/95 mix-blend-multiply" />
      <div className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.4)_100%)]" />

      {/* --- FOREGROUND LOGIN CARD --- */}
      <div className="relative z-20 flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500 ease-out">
          
          <div className="mb-8 text-center">
            <div className="mx-auto mb-6 inline-flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-white p-2 shadow-2xl shadow-[#1f97d4]/20 ring-1 ring-white/10">
              <img 
                src="/__mockup/images/ahava-logo.jpg" 
                alt="Ahava Medical Center" 
                className="h-full w-full object-contain"
              />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white drop-shadow-md">
              Welcome back
            </h1>
            <p className="mt-2 text-[#b3dbdd] drop-shadow">
              Time & Attendance Management System
            </p>
          </div>

          <Card className="border-white/10 bg-white/95 text-slate-900 shadow-2xl backdrop-blur-xl dark:bg-slate-950/90 dark:text-white sm:rounded-2xl sm:p-2">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl">Sign In</CardTitle>
              <CardDescription>
                Enter your credentials to access the portal
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-700 dark:text-slate-300">
                    Employee ID or Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@ahavamedical.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-slate-200 bg-white/50 focus-visible:ring-[#1f97d4] dark:border-slate-800 dark:bg-slate-900/50"
                    data-testid="login-email-input"
                  />
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-slate-700 dark:text-slate-300">
                      Password
                    </Label>
                    <a href="#" className="text-sm font-medium text-[#1f97d4] hover:text-[#123047] hover:underline dark:hover:text-[#65bbd0]">
                      Forgot password?
                    </a>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="border-slate-200 bg-white/50 pr-10 focus-visible:ring-[#1f97d4] dark:border-slate-800 dark:bg-slate-900/50"
                      data-testid="login-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      data-testid="login-toggle-password"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                      <span className="sr-only">
                        {showPassword ? "Hide password" : "Show password"}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <Checkbox 
                    id="remember" 
                    className="border-slate-300 data-[state=checked]:bg-[#009972] data-[state=checked]:text-white dark:border-slate-700"
                    data-testid="login-remember-checkbox" 
                  />
                  <Label
                    htmlFor="remember"
                    className="text-sm font-medium leading-none text-slate-600 peer-disabled:cursor-not-allowed peer-disabled:opacity-70 dark:text-slate-400"
                  >
                    Remember me for 30 days
                  </Label>
                </div>

                <Button 
                  type="submit" 
                  className="mt-6 w-full bg-[#123047] text-white hover:bg-[#123047]/90 dark:bg-[#1f97d4] dark:hover:bg-[#1f97d4]/90"
                  disabled={isLoading}
                  data-testid="login-submit-button"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                      Signing in...
                    </div>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </CardContent>
            <CardFooter className="flex flex-col border-t border-slate-100 pb-6 pt-6 dark:border-slate-800">
              <div className="text-center text-sm text-slate-500 dark:text-slate-400">
                Need help accessing your account? <br className="sm:hidden" />
                <a href="#" className="font-medium text-[#1f97d4] hover:underline">
                  Contact IT Support
                </a>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
      
    </div>
  );
}
