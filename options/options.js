// options/options.js
import { SUPPORTED_LANGUAGES, DEFAULT_SETTINGS, getSettings, saveSettings } from '../utils/storage.js';
import { callGemini } from '../utils/gemini.js';

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
  const testApiKeyBtn = document.getElementById('testApiKeyBtn');
  const apiKeyStatus = document.getElementById('apiKeyStatus');
  const modelSelect = document.getElementById('modelSelect');
  const customModelInput = document.getElementById('customModelInput');
  const sourceLangList = document.getElementById('sourceLangList');
  const sourceLangWarning = document.getElementById('sourceLangWarning');
  const targetLangSelect = document.getElementById('targetLangSelect');
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

  // 2. 타겟 언어 셀렉트 박스 렌더링
  targetLangSelect.innerHTML = SUPPORTED_LANGUAGES.map(lang => `
    <option value="${lang.code}" ${lang.code === settings.targetLang ? 'selected' : ''}>
      ${lang.name}
    </option>
  `).join('');

  // 3. 소스 언어 체크박스 렌더링 및 상태 관리
  let currentSourceLangs = Array.isArray(settings.sourceLangs) && settings.sourceLangs.length > 0
    ? [...settings.sourceLangs]
    : [...DEFAULT_SETTINGS.sourceLangs];

  // DOM 1회 생성
  sourceLangList.innerHTML = SUPPORTED_LANGUAGES.map(lang => `
    <label class="checkbox-label" data-code="${lang.code}">
      <input type="checkbox" value="${lang.code}">
      <span>${lang.name}</span>
    </label>
  `).join('');

  // UI 상태 동기화 함수
  function updateCheckboxUI() {
    const isMax = currentSourceLangs.length >= 2;
    sourceLangList.querySelectorAll('.checkbox-label').forEach(label => {
      const code = label.getAttribute('data-code');
      const input = label.querySelector('input[type="checkbox"]');
      const isChecked = currentSourceLangs.includes(code);

      input.checked = isChecked;
      label.classList.toggle('checked', isChecked);

      // 이미 2개가 선택되어 있고 본인이 체크되지 않은 경우 비활성화
      const shouldDisable = isMax && !isChecked;
      input.disabled = shouldDisable;
      label.classList.toggle('disabled', shouldDisable);
    });
  }

  // 체크박스 클릭 이벤트 리스너 등록
  sourceLangList.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const code = input.value;
      if (input.checked) {
        if (currentSourceLangs.length >= 2) {
          input.checked = false;
          sourceLangWarning.textContent = '소스 언어는 최대 2개까지만 선택할 수 있습니다.';
          return;
        }
        if (!currentSourceLangs.includes(code)) {
          currentSourceLangs.push(code);
        }
        sourceLangWarning.textContent = '';
      } else {
        currentSourceLangs = currentSourceLangs.filter(c => c !== code);
        sourceLangWarning.textContent = '';
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
    apiKeyStatus.textContent = '구글 서버와 연결 중입니다...';
    apiKeyStatus.className = 'status-hint';

    try {
      await callGemini({
        apiKey: key,
        model: getSelectedModel(),
        contents: [{ parts: [{ text: 'Respond with OK' }] }]
      });
      apiKeyStatus.textContent = '✓ 유효한 Gemini API 키입니다. 정상 연결되었습니다!';
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
    if (currentSourceLangs.length === 0) {
      alert('소스 언어 후보를 최소 1개 이상 선택해 주세요.');
      return;
    }

    const newSettings = {
      apiKey: apiKeyInput.value.trim(),
      model: getSelectedModel(),
      sourceLangs: [...currentSourceLangs],
      targetLang: targetLangSelect.value
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

