// popup/popup.js
import { 
  SUPPORTED_LANGUAGES, 
  TRANSLATE_SOURCE_LANGUAGES, 
  getSettings, 
  getActiveApiKey, 
  getActiveModel, 
  getProviderLabel 
} from '../utils/storage.js';

function getLanguageName(code) {
  if (code === 'auto') return '자동 감지';
  const item = SUPPORTED_LANGUAGES.find(l => l.code === code) || TRANSLATE_SOURCE_LANGUAGES.find(l => l.code === code);
  return item ? item.name.replace(/\s*\(.*?\)/, '').trim() : code;
}

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyBadge = document.getElementById('apiKeyBadge');
  const providerBadge = document.getElementById('providerBadge');
  const modelBadge = document.getElementById('modelBadge');
  const translateLangBadge = document.getElementById('translateLangBadge');
  const reviewSourceBadge = document.getElementById('reviewSourceBadge');
  const reviewTargetBadge = document.getElementById('reviewTargetBadge');
  const shortcutBadge = document.getElementById('shortcutBadge');
  const openOptionsBtn = document.getElementById('openOptionsBtn');

  const settings = await getSettings();
  const provider = settings.provider || 'gemini';
  const activeApiKey = getActiveApiKey(settings);
  const activeModel = getActiveModel(settings);

  // API 키 등록 여부 표시
  if (activeApiKey && activeApiKey.trim() !== '') {
    apiKeyBadge.textContent = '등록 완료';
    apiKeyBadge.className = 'badge success';
  } else {
    apiKeyBadge.textContent = '미등록 (설정 필요)';
    apiKeyBadge.className = 'badge warning';
  }

  // 제공자 표시
  if (providerBadge) {
    providerBadge.textContent = getProviderLabel(provider);
  }

  // 모델 표시
  if (modelBadge) {
    modelBadge.textContent = activeModel;
  }

  // 번역 언어 표시 (A → B, 설명: C)
  if (translateLangBadge) {
    const src = getLanguageName(settings.translateSourceLang || 'auto');
    const tgt = getLanguageName(settings.translateTargetLang || 'ko');
    const exp = getLanguageName(settings.translateExplanationLang || 'ko');
    translateLangBadge.textContent = `${src} → ${tgt} (설명: ${exp})`;
  }

  // 검토 대상 후보 표시
  if (reviewSourceBadge) {
    const revSrc = (settings.reviewSourceLangs || ['en', 'ko']).map(getLanguageName).join(', ');
    reviewSourceBadge.textContent = revSrc || '미지정';
  }

  // 검토 설명 언어 표시
  if (reviewTargetBadge) {
    reviewTargetBadge.textContent = getLanguageName(settings.reviewTargetLang || 'ko');
  }

  // 단축키 표시 (Chrome 공식 단축키)
  if (shortcutBadge) {
    const updateShortcutText = (chromeTranslate, chromeReview) => {
      const t = chromeTranslate || '미지정';
      const r = chromeReview || '미지정';
      shortcutBadge.textContent = `${t} / ${r}`;
    };

    if (chrome.commands && chrome.commands.getAll) {
      chrome.commands.getAll((commands) => {
        const tCmd = (commands || []).find(c => c.name === 'translate_selection');
        const rCmd = (commands || []).find(c => c.name === 'review_selection');
        updateShortcutText(tCmd?.shortcut, rCmd?.shortcut);
      });
    } else {
      updateShortcutText('Alt+Shift+T', 'Alt+Shift+R');
    }
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
