// popup/popup.js
import { SUPPORTED_LANGUAGES, getSettings } from '../utils/storage.js';

function getLanguageName(code) {
  const item = SUPPORTED_LANGUAGES.find(l => l.code === code);
  return item ? item.name.replace(/\s*\(.*?\)/, '').trim() : code;
}

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyBadge = document.getElementById('apiKeyBadge');
  const sourceLangsBadge = document.getElementById('sourceLangsBadge');
  const targetLangBadge = document.getElementById('targetLangBadge');
  const modelBadge = document.getElementById('modelBadge');
  const openOptionsBtn = document.getElementById('openOptionsBtn');

  const settings = await getSettings();

  // API 키 등록 여부 표시
  if (settings.apiKey && settings.apiKey.trim() !== '') {
    apiKeyBadge.textContent = '등록 완료';
    apiKeyBadge.className = 'badge success';
  } else {
    apiKeyBadge.textContent = '미등록 (설정 필요)';
    apiKeyBadge.className = 'badge warning';
  }

  // 소스 언어 표시
  const sourceNames = (settings.sourceLangs || []).map(getLanguageName).join(', ');
  sourceLangsBadge.textContent = sourceNames || '미지정';

  // 결과 언어 표시
  targetLangBadge.textContent = getLanguageName(settings.targetLang) || '미지정';

  // 모델 표시
  if (modelBadge) {
    modelBadge.textContent = settings.model || 'gemini-3.5-flash-lite';
  }

  // 환경설정 페이지 열기
  openOptionsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });
});

