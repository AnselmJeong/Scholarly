export type AIProvider = 'ollama' | 'claude' | 'codex';

export interface ModelPair {
  chatModel: string;
  guideModel: string;
}

export type ProviderModels = Record<AIProvider, ModelPair>;

export const DEFAULT_PROVIDER_MODELS: ProviderModels = {
  ollama: { chatModel: 'mistral-large-3:675b-cloud', guideModel: 'nemotron-3-nano:30b-cloud' },
  claude: { chatModel: 'sonnet', guideModel: 'sonnet' },
  // Empty means the CLI's current default, rather than a hard-coded model that
  // may not be available to a particular subscription.
  codex: { chatModel: '', guideModel: '' }
};

export function isAIProvider(value: unknown): value is AIProvider {
  return value === 'ollama' || value === 'claude' || value === 'codex';
}

export interface ProviderConnection {
  provider: AIProvider;
  claudePath: string;
  codexPath: string;
}

export interface ProviderStatus {
  available: boolean;
  message: string;
}
