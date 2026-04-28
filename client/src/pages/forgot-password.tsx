import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
      return res.json();
    },
    onSuccess: () => {
      setServiceError(null);
      setSubmitted(true);
    },
    onError: (err: unknown) => {
      const code = isApiError(err) ? err.code : undefined;
      if (code === "EMAIL_NOT_CONFIGURED") {
        setServiceError(
          "Password reset emails aren't enabled yet. Please contact your administrator to reset your password.",
        );
      } else {
        const message =
          err instanceof Error ? err.message : "Could not request password reset";
        setServiceError(message);
      }
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServiceError(null);
    mutation.mutate();
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#123047] via-[#163d5a] to-[#1f97d4] p-4"
      data-testid="forgot-password-page"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle data-testid="text-forgot-title">Forgot your password?</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the email on your account and we'll send a reset link.
          </p>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4 text-center" data-testid="forgot-success">
              <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm text-muted-foreground" data-testid="text-forgot-confirmation">
                If an account with that email exists, we've sent a password reset link. The
                link expires in 1 hour.
              </p>
              <Link
                href="/"
                className="inline-flex items-center text-sm text-primary hover:underline"
                data-testid="link-back-to-login"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@ahavamedical.com"
                  autoComplete="email"
                  data-testid="input-forgot-email"
                />
              </div>

              {serviceError && (
                <div
                  className="bg-red-50 border border-red-100 rounded-md px-3 py-2 text-sm text-red-700"
                  role="alert"
                  data-testid="text-forgot-error"
                >
                  {serviceError}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={mutation.isPending || !email}
                data-testid="button-submit-forgot"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send reset link"
                )}
              </Button>

              <div className="text-center">
                <Link
                  href="/"
                  className="inline-flex items-center text-sm text-muted-foreground hover:text-primary"
                  data-testid="link-back-to-login"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
