import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Eye, EyeOff, Loader2, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function readToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") || "";
}

export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const token = useMemo(() => readToken(), []);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [success, setSuccess] = useState(false);

  const { data: preflight, isLoading: preflightLoading } = useQuery<{ status: string }>({
    queryKey: ["/api/auth/reset-token-status", token],
    queryFn: async () => {
      const res = await fetch(
        `/api/auth/reset-token-status?token=${encodeURIComponent(token)}`,
      );
      if (!res.ok) return { status: "invalid" };
      return res.json();
    },
    enabled: Boolean(token),
    staleTime: 0,
  });

  useEffect(() => {
    if (preflight && preflight.status !== "valid") {
      setTokenInvalid(true);
    }
  }, [preflight]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/reset-password", {
        token,
        newPassword,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setSuccess(true);
      queryClient.setQueryData(["/api/auth/user"], data);
      toast({ title: "Password reset", description: "You're now signed in." });
      setTimeout(() => navigate("/"), 800);
    },
    onError: (err: unknown) => {
      const code = isApiError(err) ? err.code : undefined;
      if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED" || code === "TOKEN_USED") {
        setTokenInvalid(true);
      } else {
        const message =
          err instanceof Error ? err.message : "Could not reset password";
        setPageError(message);
      }
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPageError(null);
    if (newPassword.length < 8) {
      setPageError("Password must be at least 8 characters.");
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setPageError("Password must include at least one letter and one number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPageError("Passwords do not match.");
      return;
    }
    mutation.mutate();
  };

  if (token && preflightLoading && !tokenInvalid) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#123047] via-[#163d5a] to-[#1f97d4] p-4"
        data-testid="reset-password-loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (!token || tokenInvalid) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#123047] via-[#163d5a] to-[#1f97d4] p-4"
        data-testid="reset-password-page"
      >
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-2">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
            <CardTitle data-testid="text-reset-invalid-title">Reset link no longer valid</CardTitle>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-reset-invalid">
              This password reset link is invalid, expired, or has already been used.
              Please request a new one.
            </p>
          </CardHeader>
          <CardContent className="text-center space-y-3">
            <Link href="/forgot-password">
              <Button className="w-full" data-testid="button-request-new-link">
                Request a new link
              </Button>
            </Link>
            <Link href="/" className="text-sm text-muted-foreground hover:text-primary inline-block" data-testid="link-back-to-login">
              Back to sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#123047] via-[#163d5a] to-[#1f97d4] p-4"
      data-testid="reset-password-page"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle data-testid="text-reset-title">Choose a new password</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            At least 8 characters, including a letter and a number.
          </p>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="text-center space-y-3" data-testid="reset-success">
              <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm text-muted-foreground">Password updated. Signing you in…</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="newPassword"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="pl-10 pr-10"
                    autoComplete="new-password"
                    required
                    data-testid="input-reset-new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    data-testid="button-toggle-reset-new"
                    aria-label={showNew ? "Hide password" : "Show password"}
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="pl-10 pr-10"
                    autoComplete="new-password"
                    required
                    data-testid="input-reset-confirm-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    data-testid="button-toggle-reset-confirm"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {pageError && (
                <div
                  className="bg-red-50 border border-red-100 rounded-md px-3 py-2 text-sm text-red-700"
                  role="alert"
                  data-testid="text-reset-error"
                >
                  {pageError}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={mutation.isPending}
                data-testid="button-submit-reset"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Set new password"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
