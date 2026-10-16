// options/options.js
import { 
  SUPPORTED_LANGUAGES, 
  TRANSLATE_SOURCE_LANGUAGES, 
  DEFAULT_SETTINGS, 
  getSettings, 
  saveSettings 
} from '../utils/storage.js';
import { callGemini } from '../utils/gemini.js';

document.addEventListener('DOMContentLoaded', async () => {
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

  // 저장 요소
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // 현재 설정 로드
  const settings = await getSettings();

  // 1. API 키 및 모델 세팅
  apiKeyInput.value = settings.apiKey || '';
  
  const savedModel = settings.model || DEFAULT_SETTINGS.model;
  const isPresetModel = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
  if (isPresetModel) {
    modelSelect.value = savedModel;
    customModelInput.style.display = 'none';
  } else {
    modelSelect.value = 'custom';
    customModelInput.value = savedModel;
    customModelInput.style.display = 'block';
  }

  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
      customModelInput.style.display = 'block';
      customModelInput.focus();
    } else {
      customModelInput.style.display = 'none';
    }
  });

  function getSelectedModel() {
    if (modelSelect.value === 'custom') {
      return customModelInput.value.trim() || 'gemini-3.5-flash-lite';
    }
    return modelSelect.value;
  }

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
      await callGemini({
        apiKey: key,
        model: getSelectedModel(),
        contents: [{ parts: [{ text: 'Respond with OK' }] }]
      });
      apiKeyStatus.textContent = '✓ 유효한 API 키입니다. 정상 연결되었습니다!';
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

    const newSettings = {
      apiKey: apiKeyInput.value.trim(),
      model: getSelectedModel(),
      // 번역 설정
      translateSourceLang: translateSourceSelect.value,
      translateTargetLang: translateTargetSelect.value,
      translateExplanationLang: translateExplanationSelect.value,
      // 검토 설정
      reviewSourceLangs: [...currentReviewSourceLangs],
      reviewTargetLang: reviewTargetSelect.value
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
