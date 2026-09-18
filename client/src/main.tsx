import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";
import { installAuthFetchInterceptor } from "./lib/authToken";

installAuthFetchInterceptor();

// Register the service worker so the app is installable to the home screen for
// every role. registerType is "autoUpdate", so new content is picked up and the
// page reloaded automatically — silent and non-intrusive. In dev this resolves
// to a no-op stub (devOptions.enabled is false), so it is safe to import here.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);
