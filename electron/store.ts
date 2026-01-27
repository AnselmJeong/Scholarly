import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const SETTINGS_FILE = 'settings.json';

export interface AppSettings {
  ai: {
    chatModel: string;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    chatModel: 'mistral-large-3:675b-cloud'
  }
};

export function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export function loadSettings(): AppSettings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      // Merge with default to ensure structure
      return { 
        ...DEFAULT_SETTINGS, 
        ...settings, 
        ai: { ...DEFAULT_SETTINGS.ai, ...(settings.ai || {}) } 
      };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  try {
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}
