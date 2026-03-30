import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";

export function Institutional() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      {/* Top Brand Section - Full Bleed */}
      <div className="w-full bg-gradient-to-b from-[#123047] to-[#1f97d4] pt-16 pb-24 px-6 flex flex-col items-center justify-center text-center relative overflow-hidden">
        {/* Abstract background pattern for depth */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, #ffffff 0%, transparent 70%)' }}></div>
        
        <div className="relative z-10 max-w-2xl mx-auto flex flex-col items-center">
          <div className="bg-white p-4 rounded-xl shadow-2xl mb-8 border-4 border-white/20">
            <img 
              src="/__mockup/images/ahava-logo.jpg" 
              alt="Ahava Medical Center Logo" 
              className="h-20 w-auto object-contain"
            />
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">
            Ahava Medical Center
          </h1>
          <p className="text-xl text-[#b3dbdd] font-medium tracking-wide">
            Time & Attendance Management System
          </p>
        </div>
      </div>

      {/* Form Section - Clean White Area */}
      <div className="flex-1 w-full flex flex-col items-center justify-start -mt-8 px-6">
        <div className="w-full max-w-sm">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[#123047] font-semibold text-base">
                  Corporate Email
                </Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-gray-400" />
                  </div>
                  <Input
                    id="email"
                    type="email"
                    placeholder="firstname.lastname@ahavamedical.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid="email-input"
                    className="pl-10 h-14 text-base border-gray-300 focus:border-[#1f97d4] focus:ring-[#1f97d4] rounded-lg bg-gray-50/50"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[#123047] font-semibold text-base">
                    Password
                  </Label>
                  <a href="#" className="text-sm font-medium text-[#1f97d4] hover:text-[#123047] transition-colors">
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your network password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    data-testid="password-input"
                    className="pl-10 h-14 text-base border-gray-300 focus:border-[#1f97d4] focus:ring-[#1f97d4] rounded-lg bg-gray-50/50"
                  />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              data-testid="submit-button"
              className="w-full h-14 text-lg font-bold bg-[#009972] hover:bg-[#007a5b] text-white rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* Footer Section */}
      <footer className="w-full py-8 text-center text-sm text-gray-500 flex flex-col items-center gap-2 mt-auto">
        <div className="flex items-center justify-center gap-2 text-[#56b9ca] bg-[#56b9ca]/10 px-4 py-2 rounded-full">
          <ShieldCheck className="h-4 w-4" />
          <span className="font-medium">Secure access for authorized personnel only</span>
        </div>
        <p className="mt-4 text-gray-400">
          &copy; {new Date().getFullYear()} Ahava Medical Center. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
