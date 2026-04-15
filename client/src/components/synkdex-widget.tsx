import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

const WIDGET_SCRIPT_ID = "synkdex-widget-script";

export function SynkDexWidget() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const apiKey = import.meta.env.VITE_SYNKDEX_API_KEY;
    if (!apiKey) return;

    const existing = document.getElementById(WIDGET_SCRIPT_ID);
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.id = WIDGET_SCRIPT_ID;
    script.src = "https://synkdex.com/widget.js";
    script.async = true;
    script.setAttribute("data-api-key", apiKey);
    script.setAttribute("data-brand-name", "Ahava Medical");
    script.setAttribute("data-brand-logo", "https://synkdex.com/synkdex-logo.webp");
    script.setAttribute("data-user-name", `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim());
    script.setAttribute("data-user-email", user.email ?? "");

    document.body.appendChild(script);

    return () => {
      const el = document.getElementById(WIDGET_SCRIPT_ID);
      if (el) el.remove();
    };
  }, [user]);

  return null;
}
