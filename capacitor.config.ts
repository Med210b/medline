import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.medline.app',
  appName: 'MedLine',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
