import { DEFAULT_PROVIDER_MODELS, isAIProvider } from '../src/types/ai';
import type { AIProvider, ProviderModels } from '../src/types/ai';
import { app, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';
import { DIGEST_PROMPT_VERSION } from './services/digest';
import type { DigestOutputLanguage } from './services/digest';

const SETTINGS_FILE = 'settings.json';

export type MarkdownTheme = 'lapis-dark' | 'lapis' | 'vercel' | 'newsprint';

export interface AppSettings {
  ai: {
    provider: AIProvider;
    claudePath: string;
    codexPath: string;
    modelsByProvider: ProviderModels;
    chatModel: string;
    guideModel: string;
    guidePrompt: string;
    outputLanguage: DigestOutputLanguage;
    promptVersion: string;
    ollamaApiKey: string;
  };
  ui: {
    markdownTheme: MarkdownTheme;
  };
}

export interface SettingsUpdate {
  ai: {
    provider: AIProvider;
    claudePath: string;
    codexPath: string;
    modelsByProvider: ProviderModels;
    chatModel: string;
    guideModel: string;
    guidePrompt: string;
    outputLanguage: DigestOutputLanguage;
    promptVersion: string;
    ollamaApiKey?: string;
  };
  ui: {
    markdownTheme: MarkdownTheme;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function isMarkdownTheme(value: unknown): value is MarkdownTheme {
  return value === 'lapis-dark' || value === 'lapis' || value === 'vercel' || value === 'newsprint';
}

function isOutputLanguage(value: unknown): value is DigestOutputLanguage {
  return value === 'ko' || value === 'en';
}

function decryptApiKey(encryptedApiKey: string): string {
  if (!encryptedApiKey || !safeStorage.isEncryptionAvailable()) return '';

  try {
    return safeStorage.decryptString(Buffer.from(encryptedApiKey, 'base64'));
  } catch (error) {
    console.error('Failed to decrypt the Ollama API key:', error);
    return '';
  }
}

function encryptApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable. The Ollama API key was not saved.');
  }
  return safeStorage.encryptString(apiKey).toString('base64');
}

export function getDefaultGuidePrompt(): string {
  // The versioned structural prompt is application-controlled in digest.ts.
  // This field is optional, lower-authority pedagogical guidance only.
  return '';
}

function loadLegacyGuidePrompt(): string {
  try {
    const promptCandidates = [
      path.join(process.resourcesPath, 'pdf-tutor', 'resources', 'prompt.txt'),
      path.join(app.getAppPath(), 'RESOURCE', 'pdf_tutor', 'resources', 'prompt.txt')
    ];
    for (const promptPath of promptCandidates) {
      if (fs.existsSync(promptPath)) return fs.readFileSync(promptPath, 'utf8');
    }
  } catch (error) {
    console.error('Error loading legacy guide prompt:', error);
  }
  return '';
}

function isLegacyCriticalReadingPrompt(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes('point out any implicit assumptions') ||
    normalized.includes('suggest what kinds of empirical or theoretical work') ||
    normalized.includes('where a reader commonly gets confused');
}

const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    provider: 'ollama',
    claudePath: '',
    codexPath: '',
    modelsByProvider: DEFAULT_PROVIDER_MODELS,
    chatModel: 'mistral-large-3:675b-cloud',
    guideModel: 'nemotron-3-nano:30b-cloud',
    guidePrompt: getDefaultGuidePrompt(),
    outputLanguage: 'ko',
    promptVersion: DIGEST_PROMPT_VERSION,
    ollamaApiKey: ''
  },
  ui: {
    markdownTheme: 'lapis-dark'
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
      const parsed: unknown = JSON.parse(data);
      if (!isRecord(parsed)) return DEFAULT_SETTINGS;

      const ai = isRecord(parsed.ai) ? parsed.ai : {};
      const ui = isRecord(parsed.ui) ? parsed.ui : {};
      const provider = isAIProvider(ai.provider) ? ai.provider : 'ollama';
      const modelsByProvider = { ...DEFAULT_PROVIDER_MODELS };
      if (isRecord(ai.modelsByProvider)) {
        for (const name of ['ollama', 'claude', 'codex'] as const) {
          const pair = ai.modelsByProvider[name];
          if (isRecord(pair)) modelsByProvider[name] = {
            chatModel: readString(pair, 'chatModel', DEFAULT_PROVIDER_MODELS[name].chatModel),
            guideModel: readString(pair, 'guideModel', DEFAULT_PROVIDER_MODELS[name].guideModel)
          };
        }
      }
      modelsByProvider[provider] = {
        chatModel: readString(ai, 'chatModel', modelsByProvider[provider].chatModel),
        guideModel: readString(ai, 'guideModel', modelsByProvider[provider].guideModel)
      };
      const encryptedApiKey = readString(ai, 'ollamaApiKeyEncrypted', '');
      // Read a short-lived legacy plaintext value only so the next save can migrate it.
      const legacyApiKey = readString(ai, 'ollamaApiKey', '');
      const storedGuidePrompt = readString(ai, 'guidePrompt', DEFAULT_SETTINGS.ai.guidePrompt);
      const legacyGuidePrompt = loadLegacyGuidePrompt();

      return {
        ai: {
          provider,
          claudePath: readString(ai, 'claudePath', ''),
          codexPath: readString(ai, 'codexPath', ''),
          modelsByProvider,
          ...modelsByProvider[provider],
          guidePrompt: (legacyGuidePrompt && storedGuidePrompt.trim() === legacyGuidePrompt.trim()) || isLegacyCriticalReadingPrompt(storedGuidePrompt)
            ? ''
            : storedGuidePrompt,
          outputLanguage: isOutputLanguage(ai.outputLanguage)
            ? ai.outputLanguage
            : DEFAULT_SETTINGS.ai.outputLanguage,
          promptVersion: DIGEST_PROMPT_VERSION,
          ollamaApiKey: decryptApiKey(encryptedApiKey) || legacyApiKey
        },
        ui: {
          markdownTheme: isMarkdownTheme(ui.markdownTheme)
            ? ui.markdownTheme
            : DEFAULT_SETTINGS.ui.markdownTheme
        }
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
    const persistedSettings = {
      ai: {
        provider: settings.ai.provider,
        claudePath: settings.ai.claudePath,
        codexPath: settings.ai.codexPath,
        modelsByProvider: settings.ai.modelsByProvider,
        chatModel: settings.ai.chatModel,
        guideModel: settings.ai.guideModel,
        guidePrompt: settings.ai.guidePrompt,
        outputLanguage: settings.ai.outputLanguage,
        promptVersion: settings.ai.promptVersion,
        ollamaApiKeyEncrypted: encryptApiKey(settings.ai.ollamaApiKey)
      },
      ui: settings.ui
    };
    fs.writeFileSync(settingsPath, JSON.stringify(persistedSettings, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}
