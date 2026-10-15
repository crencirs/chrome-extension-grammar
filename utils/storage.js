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

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  sourceLangs: ['ko', 'en'], // A: 후보 언어 최대 2개
  targetLang: 'en'           // B: 타겟 언어 1개
};

/**
 * 저장된 설정을 불러옵니다.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      // sync 저장소가 비어있거나 에러인 경우 대비
      if (chrome.runtime.lastError) {
        chrome.storage.local.get(DEFAULT_SETTINGS, (localItems) => {
          resolve(localItems);
        });
      } else {
        resolve(items);
      }
    });
  });
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

