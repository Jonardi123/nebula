import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard'

const config: CapacitorConfig = {
  appId: 'com.jonard.nebula',
  appName: 'Nebula',
  webDir: 'mobile-dist',
  ios: {
    // Nebula owns its safe-area padding. Letting WKWebView add another inset
    // leaves a visible strip below the native app and breaks keyboard sizing.
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scheme: 'Nebula',
  },
  server: {
    iosScheme: 'capacitor',
  },
  plugins: {
    Keyboard: { resize: KeyboardResize.Native, style: KeyboardStyle.Dark, resizeOnFullScreen: true },
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: '#000000',
      showSpinner: false,
    },
    StatusBar: { style: 'dark', overlaysWebView: true },
  },
}

export default config
