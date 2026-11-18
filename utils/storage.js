// utils/storage.js

export const SUPPORTED_LANGUAGES = [
  { code: 'ko', name: '한국어 (Korean)' },
  { code: 'en', name: '영어 (English)' },
  { code: 'ja', name: '일본어 (Japanese)' },
  { code: 'zh-CN', name: '중국어 간체 (Chinese Simplified)' },
  { code: 'zh-TW', name: '중국어 번체 (Chinese Traditional)' },
  { code: 'es', name: '스페인어 (Spanish)' },
  { code: 'fr', name: '프랑스어 (French)' },
  { code: 'de', name: '독일어 (German)' },
  { code: 'vi', name: '베트남어 (Vietnamese)' },
  { code: 'ru', name: '러시아어 (Russian)' },
  { code: 'it', name: '이탈리아어 (Italian)' },
  { code: 'th', name: '태국어 (Thai)' },
  { code: 'id', name: '인도네시아어 (Indonesian)' }
];

export const TRANSLATE_SOURCE_LANGUAGES = [
  { code: 'auto', name: '언어 자동 감지 (Auto Detect)' },
  ...SUPPORTED_LANGUAGES
];

export const AI_PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini (Google AI Studio)' },
  { id: 'openrouter', name: 'OpenRouter' }
];

export const PROVIDER_MODELS = {
  gemini: [
    { value: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (추천 / 기본)' },
    { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
    { value: 'gemma-4-26b-a4b-it', label: 'gemma-4-26b-a4b-it' },
    { value: 'gemma-4-31b-it', label: 'gemma-4-31b-it' }
  ],
  openrouter: [
    { value: 'openrouter/free', label: 'openrouter/free (무료 모델 자동 선택)' },
    { value: 'google/gemma-3-27b-it:free', label: 'google/gemma-3-27b-it:free (무료 · Gemma 3 27B)' },
    { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'meta-llama/llama-3.3-70b-instruct:free (무료 · Llama 3.3 70B)' },
    { value: 'deepseek/deepseek-chat-v3-0324:free', label: 'deepseek/deepseek-chat-v3-0324:free (무료 · DeepSeek V3)' },
    { value: 'qwen/qwen3-32b:free', label: 'qwen/qwen3-32b:free (무료 · Qwen 3 32B)' },
    { value: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'mistralai/mistral-small-3.1-24b-instruct:free (무료 · Mistral Small 3.1)' },
    { value: 'openai/gpt-4o-mini', label: 'openai/gpt-4o-mini (유료 · GPT-4o Mini)' },
    { value: 'anthropic/claude-3.5-haiku', label: 'anthropic/claude-3.5-haiku (유료 · Claude 3.5 Haiku)' }
  ]
};

export const DEFAULT_SETTINGS = {
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  geminiApiKey: '',
  geminiModel: 'gemini-3.5-flash-lite',
  openrouterApiKey: '',
  openrouterModel: 'openrouter/free',
  // 번역 기능 설정
  translateSourceLang: 'auto',        // 출발 언어
  translateTargetLang: 'ko',          // 도착 언어
  translateExplanationLang: 'ko',     // 번역 참고 노트 및 설명 언어
  // 검토 기능 설정
  reviewSourceLangs: ['en', 'ko'],    // 검토 대상 후보 언어 (최대 2개)
  reviewTargetLang: 'ko'              // 피드백/설명 출력 언어
};

export function getProviderLabel(provider) {
  return provider === 'openrouter' ? 'OpenRouter' : 'Google Gemini';
}

export function getActiveApiKey(settings) {
  if (!settings) return '';
  return settings.provider === 'openrouter'
    ? (settings.openrouterApiKey || '')
    : (settings.geminiApiKey || settings.apiKey || '');
}

export function getActiveModel(settings) {
  if (!settings) return DEFAULT_SETTINGS.geminiModel;
  return settings.provider === 'openrouter'
    ? (settings.openrouterModel || DEFAULT_SETTINGS.openrouterModel)
    : (settings.geminiModel || settings.model || DEFAULT_SETTINGS.geminiModel);
}

/**
 * 저장된 설정을 불러옵니다 (기존 버전 호환성 처리 포함).
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (syncItems) => {
      let items = syncItems;
      if (chrome.runtime.lastError || !items || Object.keys(items).length === 0) {
        chrome.storage.local.get(null, (localItems) => {
          resolve(normalizeSettings(localItems || {}));
        });
      } else {
        resolve(normalizeSettings(items));
      }
    });
  });
}

function normalizeSettings(items) {
  const merged = { ...DEFAULT_SETTINGS, ...items };

  if (!merged.provider || !['gemini', 'openrouter'].includes(merged.provider)) {
    merged.provider = 'gemini';
  }

  // 기존 단일 제공자 설정 마이그레이션
  if (items.apiKey && !items.geminiApiKey) {
    merged.geminiApiKey = items.apiKey;
  }
  if (items.model && !items.geminiModel) {
    merged.geminiModel = items.model;
  }

  // 활성 제공자 기준으로 apiKey / model 동기화
  merged.apiKey = getActiveApiKey(merged);
  merged.model = getActiveModel(merged);

  // 구 버전 설정 마이그레이션 fallback
  if (!items.translateTargetLang && items.targetLang) {
    merged.translateTargetLang = items.targetLang;
  }
  if (!items.translateExplanationLang) {
    merged.translateExplanationLang = items.reviewTargetLang || items.targetLang || 'ko';
  }
  if (!items.reviewSourceLangs && items.sourceLangs) {
    merged.reviewSourceLangs = items.sourceLangs;
  }
  if (!items.reviewTargetLang && items.targetLang) {
    merged.reviewTargetLang = items.targetLang;
  }

  return merged;
}

/**
 * 설정을 저장합니다.
 * @param {Partial<typeof DEFAULT_SETTINGS>} settings
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) {
        // sync 할당량 초과 시 local로 폴백
        chrome.storage.local.set(settings, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  });
}
