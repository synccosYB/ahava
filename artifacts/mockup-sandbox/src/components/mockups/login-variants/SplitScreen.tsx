import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, ShieldCheck, Users, ChevronRight } from "lucide-react";

export function SplitScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => setIsLoading(false), 1500);
  };

  return (
    <div className="min-h-screen w-full flex bg-white font-sans">
      {/* Left Panel - Brand Storytelling */}
      <div className="hidden lg:flex w-1/2 flex-col justify-between bg-gradient-to-br from-[#123047] via-[#009972] to-[#56b9ca] p-12 text-white relative overflow-hidden">
        {/* Abstract shapes for visual interest */}
        <div className="absolute top-0 right-0 -mt-20 -mr-20 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 -mb-20 -ml-20 w-96 h-96 bg-[#1f97d4]/20 rounded-full blur-3xl" />
        
        <div className="relative z-10">
          <div className="w-48 bg-white p-3 rounded-lg mb-16 shadow-lg inline-block">
            <img 
              src="/__mockup/images/ahava-logo.jpg" 
              alt="Ahava Medical Center" 
              className="h-10 w-auto object-contain"
            />
          </div>
          
          <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-6">
            Simplifying Time Management for Healthcare Teams
          </h1>
          <p className="text-lg text-white/80 max-w-md mb-12">
            A centralized platform to manage attendance, scheduling, and staff coverage across all Ahava facilities.
          </p>

          <div className="space-y-8">
            <div className="flex items-start gap-4">
              <div className="bg-white/10 p-3 rounded-lg backdrop-blur-sm mt-1">
                <Clock className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Real-time Attendance</h3>
                <p className="text-white/70 text-sm mt-1">Live tracking of staff punch-ins and shift changes.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="bg-white/10 p-3 rounded-lg backdrop-blur-sm mt-1">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Department Scheduling</h3>
                <p className="text-white/70 text-sm mt-1">Seamless coverage coordination across multiple locations.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="bg-white/10 p-3 rounded-lg backdrop-blur-sm mt-1">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Compliance Ready</h3>
                <p className="text-white/70 text-sm mt-1">Built to meet healthcare workforce regulations and reporting.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="relative z-10 text-sm text-white/60 pt-12">
          &copy; {new Date().getFullYear()} Ahava Medical Center. All rights reserved.
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8 sm:p-12 lg:p-24 bg-white relative">
        <div className="w-full max-w-md">
          {/* Mobile Logo (hidden on desktop) */}
          <div className="lg:hidden flex justify-center mb-10">
            <img 
              src="/__mockup/images/ahava-logo.jpg" 
              alt="Ahava Medical Center" 
              className="h-12 w-auto object-contain"
            />
          </div>

          <div className="mb-10 text-center lg:text-left">
            <h2 className="text-3xl font-bold text-[#123047] mb-2">Welcome Back</h2>
            <p className="text-slate-500">Sign in to your Ahava HR account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 font-medium">Email Address</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="name@ahavamedical.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 border-slate-200 focus:border-[#009972] focus:ring-[#009972] transition-colors"
                data-testid="email-input"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="password" className="text-slate-700 font-medium">Password</Label>
                <a href="#" className="text-sm font-medium text-[#009972] hover:text-[#123047] transition-colors" data-testid="forgot-password-link">
                  Forgot password?
                </a>
              </div>
              <Input 
                id="password" 
                type="password" 
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 border-slate-200 focus:border-[#009972] focus:ring-[#009972] transition-colors"
                data-testid="password-input"
              />
            </div>

            <div className="flex items-center space-x-2 pb-2">
              <Checkbox id="remember" className="border-slate-300 text-[#009972] focus:ring-[#009972] data-[state=checked]:bg-[#009972]" data-testid="remember-checkbox" />
              <label
                htmlFor="remember"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-slate-600"
              >
                Remember me for 30 days
              </label>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-semibold bg-[#123047] hover:bg-[#009972] text-white transition-all duration-300 group shadow-md hover:shadow-lg"
              disabled={isLoading}
              data-testid="submit-button"
            >
              {isLoading ? (
                "Signing In..."
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Sign In
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-8 pt-8 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              Need access? <a href="#" className="text-[#009972] font-semibold hover:underline" data-testid="support-link">Contact HR Support</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
