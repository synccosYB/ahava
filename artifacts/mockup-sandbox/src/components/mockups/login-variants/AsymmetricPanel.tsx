import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, Calendar, Shield, Mail, Lock, AlertCircle } from "lucide-react";

export function AsymmetricPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setError("");
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      // In a real app, handle success/redirect here
      console.log("Login submitted", { email, password });
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col md:grid md:grid-cols-[1fr_420px] overflow-y-auto font-sans">
      {/* LEFT PANEL - BRAND & CONTEXT */}
      <div className="bg-[#123047] flex flex-col justify-between p-8 md:p-12 relative overflow-hidden shrink-0 min-h-[300px]">
        {/* Abstract background elements */}
        <div className="absolute top-0 right-0 -mr-32 -mt-32 w-96 h-96 rounded-full bg-[#1f97d4] opacity-10 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-[#009972] opacity-10 blur-3xl"></div>

        {/* Header */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="h-10 w-10 bg-white rounded flex items-center justify-center p-1 shadow-md overflow-hidden">
            <img 
              src="/__mockup/images/ahava-logo.jpg" 
              alt="Ahava Medical Center Logo" 
              className="w-full h-full object-contain"
            />
          </div>
          <span className="text-white font-medium tracking-wide">Ahava Medical Center</span>
        </div>

        {/* Center Content */}
        <div className="my-16 md:my-auto relative z-10 max-w-lg">
          <div className="w-[2px] h-16 bg-[#56b9ca] mb-6 rounded-full"></div>
          <h2 className="text-2xl md:text-3xl font-light text-white/90 leading-relaxed italic mb-4 font-serif">
            "Caring for our team,<br />so they can care for others."
          </h2>
          <p className="text-white/50 text-xs md:text-sm tracking-widest uppercase font-semibold">
            Time & Attendance Management
          </p>
        </div>

        {/* Footer Features */}
        <div className="hidden md:flex gap-8 relative z-10 pt-8 border-t border-white/10">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-white/30" aria-hidden="true" />
            <span className="text-white/40 text-xs font-medium">Track Hours</span>
          </div>
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-white/30" aria-hidden="true" />
            <span className="text-white/40 text-xs font-medium">Manage PTO</span>
          </div>
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-white/30" aria-hidden="true" />
            <span className="text-white/40 text-xs font-medium">Secure Access</span>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL - LOGIN FORM */}
      <div className="flex-1 flex flex-col justify-center px-8 py-12 md:p-12 relative bg-white">
        <div className="w-full max-w-sm mx-auto">
          
          <div className="mb-10">
            <h1 className="text-2xl font-semibold text-[#123047] mb-2">Welcome back</h1>
            <p className="text-sm text-gray-500">Sign in to your account to continue</p>
          </div>

          {error && (
            <div role="alert" className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 rounded-md flex items-start gap-2 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">Email Address</Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" aria-hidden="true" />
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@ahavamedical.com"
                  className="pl-10 border-gray-200 focus:border-[#1f97d4] focus:ring-[#1f97d4] h-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="login-email-input"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-gray-700">Password</Label>
                <a href="#" className="text-xs font-medium text-[#1f97d4] hover:text-[#123047] transition-colors">
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" aria-hidden="true" />
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10 border-gray-200 focus:border-[#1f97d4] focus:ring-[#1f97d4] h-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="login-password-input"
                  disabled={isLoading}
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-[#009972] hover:bg-[#008261] text-white h-11 text-base font-medium shadow-sm transition-all"
              data-testid="login-submit-button"
              disabled={isLoading}
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="mt-12 text-center">
            <p className="text-xs text-gray-400">
              &copy; {new Date().getFullYear()} Ahava Medical Center. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
