import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // The service worker and manifest are emitted to the build root
      // (dist/public) so their scope covers the whole app for every role.
      manifest: {
        name: "Ahava Time & Attendance",
        short_name: "Ahava T&A",
        description:
          "Ahava Medical Center Time & Attendance — clock in/out, time off and approvals.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#123047",
        background_color: "#ffffff",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the built app shell (JS/CSS/HTML/icons) for fast loads.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        // This is a large single-bundle SPA (face-api etc.); allow the shell
        // chunk to be precached with headroom so SW generation never errors on
        // a big-but-legitimate bundle. The production bundle is ~1.6 MB.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The SPA is served by Express; fall back to the app shell on
        // navigation so deep links still boot when offline/flaky.
        navigateFallback: "/index.html",
        // Authenticated data must never be cached — always hit the network
        // for API/auth/health routes and never route them to the SPA shell.
        navigateFallbackDenylist: [/^\/api/, /^\/internal/, /^\/health/, /^\/ready/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api") ||
              url.pathname.startsWith("/internal"),
            handler: "NetworkOnly",
            method: "GET",
          },
          {
            // App-shell navigations: prefer the network so fresh HTML wins,
            // but fall back to the precached shell when the network fails.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "app-shell",
              networkTimeoutSeconds: 5,
            },
          },
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      // Disable the dev-time service worker to avoid stale caching while
      // developing; the SW is exercised in production builds.
      devOptions: {
        enabled: false,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
