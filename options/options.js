// options/options.js
import { 
  SUPPORTED_LANGUAGES, 
  TRANSLATE_SOURCE_LANGUAGES, 
  PROVIDER_MODELS,
  DEFAULT_SETTINGS, 
  getSettings, 
  saveSettings 
} from '../utils/storage.js';
import { callGemini } from '../utils/gemini.js';

document.addEventListener('DOMContentLoaded', async () => {
  const providerSelect = document.getElementById('providerSelect');
  const providerDescription = document.getElementById('providerDescription');
  const apiKeyInput = document.getElementById('apiKey');
  const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
  const testApiKeyBtn = document.getElementById('testApiKeyBtn');
  const apiKeyStatus = document.getElementById('apiKeyStatus');
  const modelSelect = document.getElementById('modelSelect');
  const customModelInput = document.getElementById('customModelInput');

  // 번역 설정 요소
  const translateSourceSelect = document.getElementById('translateSourceSelect');
  const translateTargetSelect = document.getElementById('translateTargetSelect');
  const translateExplanationSelect = document.getElementById('translateExplanationSelect');

  // 검토 설정 요소
  const reviewSourceLangList = document.getElementById('reviewSourceLangList');
  const reviewSourceLangWarning = document.getElementById('reviewSourceLangWarning');
  const reviewTargetSelect = document.getElementById('reviewTargetSelect');

  // 단축키 설정 요소
  const refreshShortcutsBtn = document.getElementById('refreshShortcutsBtn');
  const openChromeShortcutsBtn = document.getElementById('openChromeShortcutsBtn');
  const chromeTranslateShortcut = document.getElementById('chromeTranslateShortcut');
  const chromeReviewShortcut = document.getElementById('chromeReviewShortcut');
  const autoSelectFocusedCheckbox = document.getElementById('autoSelectFocusedCheckbox');

  // 저장 요소
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // 현재 설정 로드
  const settings = await getSettings();

  // 1. 제공자, API 키 및 모델 세팅
  let currentProvider = settings.provider || DEFAULT_SETTINGS.provider;
  const providerState = {
    gemini: {
      apiKey: settings.geminiApiKey || (currentProvider === 'gemini' ? settings.apiKey : '') || '',
      model: settings.geminiModel || (currentProvider === 'gemini' ? settings.model : '') || DEFAULT_SETTINGS.geminiModel
    },
    openrouter: {
      apiKey: settings.openrouterApiKey || (currentProvider === 'openrouter' ? settings.apiKey : '') || '',
      model: settings.openrouterModel || (currentProvider === 'openrouter' ? settings.model : '') || DEFAULT_SETTINGS.openrouterModel
    }
  };

  function getSelectedModel() {
    if (modelSelect.value === 'custom') {
      const fallback = currentProvider === 'openrouter' ? DEFAULT_SETTINGS.openrouterModel : DEFAULT_SETTINGS.geminiModel;
      return customModelInput.value.trim() || fallback;
    }
    return modelSelect.value;
  }

  function renderProviderUI(provider) {
    const isOpenRouter = provider === 'openrouter';
    const state = providerState[provider];

    if (isOpenRouter) {
      providerDescription.innerHTML = 'OpenRouter에서 발급받은 API 키를 입력해 주세요. 다양한 무료(<code>:free</code>) 및 유료 AI 모델을 하나의 키로 사용할 수 있습니다. <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter API 키 발급받기 &rarr;</a>';
      apiKeyInput.placeholder = 'sk-or-v1-...';
      customModelInput.placeholder = '모델명 직접 입력 (예: google/gemini-2.5-flash-preview)';
    } else {
      providerDescription.innerHTML = 'AI 서비스(Google AI Studio)에서 발급받은 API 키를 입력해 주세요. <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">API 키 발급받기 &rarr;</a>';
      apiKeyInput.placeholder = 'AIzaSy...';
      customModelInput.placeholder = '모델명 직접 입력 (예: gemini-3.5-flash-lite)';
    }

    apiKeyInput.value = state.apiKey || '';
    apiKeyStatus.textContent = '';
    apiKeyStatus.className = 'status-hint';

    const models = PROVIDER_MODELS[provider] || PROVIDER_MODELS.gemini;
    modelSelect.innerHTML = [
      ...models.map(m => `<option value="${m.value}">${m.label}</option>`),
      '<option value="custom">직접 입력 (Custom)...</option>'
    ].join('');

    const savedModel = state.model || models[0].value;
    const isPresetModel = models.some(m => m.value === savedModel);
    if (isPresetModel) {
      modelSelect.value = savedModel;
      customModelInput.value = '';
      customModelInput.style.display = 'none';
    } else {
      modelSelect.value = 'custom';
      customModelInput.value = savedModel;
      customModelInput.style.display = 'block';
    }
  }

  providerSelect.value = currentProvider;
  renderProviderUI(currentProvider);

  providerSelect.addEventListener('change', () => {
    // 전환 전 현재 제공자의 입력값을 메모리에 보관
    providerState[currentProvider] = {
      apiKey: apiKeyInput.value.trim(),
      model: getSelectedModel()
    };
    currentProvider = providerSelect.value;
    renderProviderUI(currentProvider);
  });

  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
      customModelInput.style.display = 'block';
      customModelInput.focus();
    } else {
      customModelInput.style.display = 'none';
    }
  });

  // 2. 번역 기능 드롭다운 렌더링
  const currentTranslateSource = settings.translateSourceLang || DEFAULT_SETTINGS.translateSourceLang;
  translateSourceSelect.innerHTML = TRANSLATE_SOURCE_LANGUAGES.map(lang => `
    <option value="${lang.code}" ${lang.code === currentTranslateSource ? 'selected' : ''}>
      ${lang.name}
    </option>
  `).join('');

  const currentTranslateTarget = settings.translateTargetLang || DEFAULT_SETTINGS.translateTargetLang;
  translateTargetSelect.innerHTML = SUPPORTED_LANGUAGES.map(lang => `
    <option value="${lang.code}" ${lang.code === currentTranslateTarget ? 'selected' : ''}>
      ${lang.name}
    </option>
  `).join('');

  const currentTranslateExplanation = settings.translateExplanationLang || DEFAULT_SETTINGS.translateExplanationLang;
  translateExplanationSelect.innerHTML = SUPPORTED_LANGUAGES.map(lang => `
    <option value="${lang.code}" ${lang.code === currentTranslateExplanation ? 'selected' : ''}>
      ${lang.name}
    </option>
  `).join('');

  // 3. 검토 기능 설명 출력 언어 드롭다운 렌더링
  const currentReviewTarget = settings.reviewTargetLang || DEFAULT_SETTINGS.reviewTargetLang;
  reviewTargetSelect.innerHTML = SUPPORTED_LANGUAGES.map(lang => `
    <option value="${lang.code}" ${lang.code === currentReviewTarget ? 'selected' : ''}>
      ${lang.name}
    </option>
  `).join('');

  // 4. 검토 기능 후보 언어 체크박스 렌더링 및 상태 관리
  let currentReviewSourceLangs = Array.isArray(settings.reviewSourceLangs) && settings.reviewSourceLangs.length > 0
    ? [...settings.reviewSourceLangs]
    : [...DEFAULT_SETTINGS.reviewSourceLangs];

  // DOM 1회 생성
  reviewSourceLangList.innerHTML = SUPPORTED_LANGUAGES.map(lang => `
    <label class="checkbox-label" data-code="${lang.code}">
      <input type="checkbox" value="${lang.code}">
      <span>${lang.name}</span>
    </label>
  `).join('');

  // UI 상태 동기화 함수
  function updateCheckboxUI() {
    const isMax = currentReviewSourceLangs.length >= 2;
    reviewSourceLangList.querySelectorAll('.checkbox-label').forEach(label => {
      const code = label.getAttribute('data-code');
      const input = label.querySelector('input[type="checkbox"]');
      const isChecked = currentReviewSourceLangs.includes(code);

      input.checked = isChecked;
      label.classList.toggle('checked', isChecked);

      // 이미 2개가 선택되어 있고 본인이 체크되지 않은 경우 비활성화
      const shouldDisable = isMax && !isChecked;
      input.disabled = shouldDisable;
      label.classList.toggle('disabled', shouldDisable);
    });
  }

  // 체크박스 클릭 이벤트 리스너 등록
  reviewSourceLangList.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => {
      const code = input.value;
      if (input.checked) {
        if (currentReviewSourceLangs.length >= 2) {
          input.checked = false;
          reviewSourceLangWarning.textContent = '검토 대상 언어는 최대 2개까지만 선택할 수 있습니다.';
          return;
        }
        if (!currentReviewSourceLangs.includes(code)) {
          currentReviewSourceLangs.push(code);
        }
        reviewSourceLangWarning.textContent = '';
      } else {
        currentReviewSourceLangs = currentReviewSourceLangs.filter(c => c !== code);
        reviewSourceLangWarning.textContent = '';
      }
      updateCheckboxUI();
    });
  });

  // 초기 상태 렌더링
  updateCheckboxUI();

  // 5. 단축키 및 빠른 실행 설정 세팅
  function loadChromeShortcuts() {
    if (!chrome.commands || !chrome.commands.getAll) {
      chromeTranslateShortcut.textContent = 'Alt+Shift+T';
      chromeReviewShortcut.textContent = 'Alt+Shift+R';
      return;
    }
    chrome.commands.getAll((commands) => {
      const translateCmd = (commands || []).find(c => c.name === 'translate_selection');
      const reviewCmd = (commands || []).find(c => c.name === 'review_selection');
      chromeTranslateShortcut.textContent = translateCmd?.shortcut || '미지정';
      chromeReviewShortcut.textContent = reviewCmd?.shortcut || '미지정';
    });
  }

  loadChromeShortcuts();

  // 단축키 설정 탭에서 돌아왔을 때 자동 갱신 + 수동 새로고침 버튼 지원
  window.addEventListener('focus', loadChromeShortcuts);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadChromeShortcuts();
  });
  refreshShortcutsBtn.addEventListener('click', loadChromeShortcuts);

  openChromeShortcutsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  autoSelectFocusedCheckbox.checked = Boolean(settings.autoSelectFocusedOnShortcut);

  const autoSelectLabel = autoSelectFocusedCheckbox.closest('.checkbox-label');
  if (autoSelectLabel) {
    autoSelectLabel.classList.toggle('checked', autoSelectFocusedCheckbox.checked);
    autoSelectFocusedCheckbox.addEventListener('change', () => {
      autoSelectLabel.classList.toggle('checked', autoSelectFocusedCheckbox.checked);
    });
  }

  // API 키 표시/숨김 토글
  toggleApiKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleApiKeyBtn.textContent = '숨김';
    } else {
      apiKeyInput.type = 'password';
      toggleApiKeyBtn.textContent = '표시';
    }
  });

  // API 키 유효성 테스트
  testApiKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      apiKeyStatus.textContent = 'API 키를 먼저 입력해 주세요.';
      apiKeyStatus.className = 'status-hint error';
      return;
    }

    testApiKeyBtn.disabled = true;
    testApiKeyBtn.textContent = '검증 중...';
    apiKeyStatus.textContent = 'AI 서버와 연결 중입니다...';
    apiKeyStatus.className = 'status-hint';

    try {
      const res = await callGemini({
        provider: currentProvider,
        apiKey: key,
        model: getSelectedModel(),
        contents: [{ parts: [{ text: 'Respond with OK' }] }],
        returnMeta: true
      });
      const timeText = typeof res?.elapsedMs === 'number'
        ? `${(res.elapsedMs / 1000).toFixed(1)}초`
        : '';
      const extraParts = [];
      if (res?.routedModel) extraParts.push(`실제 응답 모델: ${res.routedModel}`);
      if (timeText) extraParts.push(timeText);
      apiKeyStatus.textContent = extraParts.length > 0
        ? `✓ 유효한 API 키입니다. 정상 연결되었습니다! (${extraParts.join(', ')})`
        : '✓ 유효한 API 키입니다. 정상 연결되었습니다!';
      apiKeyStatus.className = 'status-hint success';
    } catch (err) {
      apiKeyStatus.textContent = `✗ 검증 실패: ${err.message}`;
      apiKeyStatus.className = 'status-hint error';
    } finally {
      testApiKeyBtn.disabled = false;
      testApiKeyBtn.textContent = 'API 키 검증';
    }
  });

  // 설정 저장
  saveBtn.addEventListener('click', async () => {
    if (currentReviewSourceLangs.length === 0) {
      alert('검토 대상 언어 후보를 최소 1개 이상 선택해 주세요.');
      return;
    }

    providerState[currentProvider] = {
      apiKey: apiKeyInput.value.trim(),
      model: getSelectedModel()
    };

    const newSettings = {
      provider: currentProvider,
      apiKey: providerState[currentProvider].apiKey,
      model: providerState[currentProvider].model,
      geminiApiKey: providerState.gemini.apiKey,
      geminiModel: providerState.gemini.model,
      openrouterApiKey: providerState.openrouter.apiKey,
      openrouterModel: providerState.openrouter.model,
      // 번역 설정
      translateSourceLang: translateSourceSelect.value,
      translateTargetLang: translateTargetSelect.value,
      translateExplanationLang: translateExplanationSelect.value,
      // 검토 설정
      reviewSourceLangs: [...currentReviewSourceLangs],
      reviewTargetLang: reviewTargetSelect.value,
      // 단축키 및 빠른 실행 설정
      autoSelectFocusedOnShortcut: Boolean(autoSelectFocusedCheckbox.checked)
    };

    try {
      await saveSettings(newSettings);
      saveStatus.textContent = '✓ 설정이 저장되었습니다.';
      saveStatus.classList.add('visible');
      setTimeout(() => {
        saveStatus.classList.remove('visible');
      }, 2500);
    } catch (err) {
      alert('설정 저장 중 오류가 발생했습니다: ' + err.message);
    }
  });
});
