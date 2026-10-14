import type { CapacitorConfig } from '@capacitor/cli';

// Deliberate development placeholder. Release builds require real Owner facts.
const config: CapacitorConfig = {
  appId: 'invalid.form.placeholder',
  appName: 'FORM',
  webDir: 'dist',
  server: { hostname: 'localhost', iosScheme: 'capacitor', allowNavigation: [] },
  ios: { contentInset: 'automatic', backgroundColor: '#f7f7f2', webContentsDebuggingEnabled: false },
  plugins: { CapacitorHttp: { enabled: false } },
};
export default config;
