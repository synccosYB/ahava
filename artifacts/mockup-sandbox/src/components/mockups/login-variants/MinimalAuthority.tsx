import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"

export function MinimalAuthority() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    
    // Static mockup behavior
    setTimeout(() => {
      if (!email || !password) {
        setError("Please enter both email and password")
        setIsLoading(false)
        return
      }
      setIsLoading(false)
    }, 1000)
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-[#f8f9fa] flex flex-col items-center relative">
      <div className="absolute top-0 left-0 right-0 h-1 bg-[#123047]" />
      
      <div className="w-full max-w-xs mt-[30vh] px-4 sm:px-0 flex flex-col">
        <img 
          src="/__mockup/images/ahava-logo.jpg" 
          alt="Ahava Medical Center Logo" 
          className="h-14 w-auto object-contain mb-6 self-start"
        />
        
        <h1 className="text-2xl font-semibold tracking-tight text-[#123047] mb-1">
          Ahava Medical Center
        </h1>
        <p className="text-sm tracking-wider uppercase text-gray-500 mb-8">
          Time & Attendance Management System
        </p>
        
        <hr className="border-t border-gray-200 w-full mb-8" />
        
        {error && (
          <div role="alert" className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-md">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-6 w-full">
          <div className="flex flex-col gap-2">
            <Label 
              htmlFor="email" 
              className="text-xs uppercase tracking-wider text-gray-500 font-medium"
            >
              Email Address
            </Label>
            <Input 
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-0 border-b border-gray-300 rounded-none px-0 bg-transparent focus-visible:ring-0 focus-visible:border-[#123047] shadow-none h-8 text-base"
              data-testid="email-input"
              disabled={isLoading}
            />
          </div>
          
          <div className="flex flex-col gap-2">
            <Label 
              htmlFor="password" 
              className="text-xs uppercase tracking-wider text-gray-500 font-medium"
            >
              Password
            </Label>
            <Input 
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-0 border-b border-gray-300 rounded-none px-0 bg-transparent focus-visible:ring-0 focus-visible:border-[#123047] shadow-none h-8 text-base"
              data-testid="password-input"
              disabled={isLoading}
            />
          </div>
          
          <Button 
            type="submit" 
            className="w-full mt-2 bg-[#123047] hover:bg-[#0c2030] text-white rounded-md shadow-none h-11 text-base font-medium transition-colors"
            data-testid="submit-button"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Sign In
          </Button>
        </form>
      </div>
    </div>
  )
}
