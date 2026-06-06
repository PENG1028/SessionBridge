import type { CapacitorConfig } from '@capacitor/cli';

/**
 * SessionBridge Mobile Shell — Capacitor configuration
 *
 * This shell loads the SessionBridge Web UI in a native WebView
 * and exposes @capacitor/local-notifications for system alerts.
 *
 * First-time setup:
 *   cd shells/mobile && npm install
 *   npx cap add android     # creates android/ project (do NOT commit)
 *   npx cap add ios         # creates ios/ project (do NOT commit, macOS only)
 *
 * Build:
 *   npm run build            → npx cap sync && npx cap build android → .apk
 *
 * Env overrides:
 *   SB_WEB_URL=http://192.168.1.100:3000 npx cap sync
 */

const config: CapacitorConfig = {
  appId: 'com.sessionbridge.mobile',
  appName: 'SessionBridge',

  // Web UI loaded remotely (no bundled www/ folder)
  server: {
    // Development: load from local network dev server
    // Production: remove this block and set webDir to a bundled www/ folder
    url: process.env.SB_WEB_URL || 'http://localhost:3000',
    cleartext: true, // allow http:// in dev
  },

  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_launcher',
      iconColor: '#0a0a0a',
    },
  },
};

export default config;
