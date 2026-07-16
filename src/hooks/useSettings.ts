import { useState, useEffect } from 'react';
import { loadSettings, saveSettings } from '../lib/settings';

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  return { settings, setSettings };
}
