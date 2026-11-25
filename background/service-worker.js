// background/service-worker.js
import { getSettings, getActiveApiKey, getActiveModel, getProviderLabel } from '../utils/storage.js';
import { translateText, reviewText } from '../utils/gemini.js';

// 확장 프로그램 설치 또는 업데이트 시 컨텍스트 메뉴 등록
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'translate_selection',
      title: '선택한 문장을 번역하기',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'review_selection',
      title: '선택한 문장을 검토하기',
      contexts: ['selection']
    });
  });
});

/**
 * 번역 또는 문장 검토를 실행하고 활성 탭에 로딩/결과/에러를 전송하는 공통 함수
 */
async function executeAiAction(tabId, mode, selectedText) {
  const trimmedText = (selectedText || '').trim();
  if (!tabId || !trimmedText) return;

  try {
    // 1. 활성 탭에 로딩 UI 띄우기 요청
    await sendMessageToTab(tabId, {
      action: 'SHOW_LOADING',
      mode,
      selectedText: trimmedText
    });

    // 2. 설정 정보 가져오기
    const settings = await getSettings();
    const provider = settings.provider || 'gemini';
    const apiKey = getActiveApiKey(settings);
    const model = getActiveModel(settings);

    if (!apiKey || apiKey.trim() === '') {
      await sendMessageToTab(tabId, {
        action: 'SHOW_ERROR',
        message: `${getProviderLabel(provider)} API 키가 설정되지 않았습니다. 확장 프로그램 아이콘을 클릭하여 설정(Options)에서 API 키를 입력해 주세요.`
      });
      return;
    }

    // 3. AI 작업 수행
    let result;
    if (mode === 'translate') {
      result = await translateText({
        text: trimmedText,
        provider,
        apiKey,
        model,
        sourceLang: settings.translateSourceLang || 'auto',
        targetLang: settings.translateTargetLang || 'ko',
        explanationLang: settings.translateExplanationLang || 'ko'
      });
    } else {
      result = await reviewText({
        text: trimmedText,
        provider,
        apiKey,
        model,
        sourceLangs: settings.reviewSourceLangs || ['en', 'ko'],
        targetLang: settings.reviewTargetLang || 'ko'
      });
    }

    // 4. 활성 탭에 결과 렌더링 요청
    await sendMessageToTab(tabId, {
      action: 'SHOW_RESULT',
      mode,
      data: result,
      originalText: trimmedText
    });
  } catch (error) {
    console.error('Service worker execution error:', error);
    await sendMessageToTab(tabId, {
      action: 'SHOW_ERROR',
      error: {
        message: error.message || '처리 중 오류가 발생했습니다.',
        status: error.status || 0,
        code: error.code || '',
        details: error.details || error.message || ''
      }
    });
  }
}

/**
 * Chrome 공식 단축키 호출 시 선택 텍스트 추출 및 실행
 */
async function triggerShortcutAction(tabId, mode) {
  if (!tabId) return;

  const settings = await getSettings();
  const autoSelectFocused = Boolean(settings.autoSelectFocusedOnShortcut);

  const selectionRes = await sendMessageToTab(tabId, {
    action: 'GET_SELECTION_FOR_SHORTCUT',
    autoSelectFocused
  });

  // 보호된 페이지(chrome:// 등) 등으로 응답이 없으면 중단
  if (!selectionRes) return;

  if (selectionRes.text && selectionRes.text.trim() !== '') {
    await executeAiAction(tabId, mode, selectionRes.text);
  } else {
    await sendMessageToTab(tabId, {
      action: 'SHOW_NOTICE',
      noticeType: selectionRes.reason || 'no_selection_option_off',
      mode
    });
  }
}

// 컨텍스트 메뉴 클릭 이벤트 처리
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  const selectedText = (info.selectionText || '').trim();
  if (!selectedText) return;

  const mode = info.menuItemId === 'translate_selection' ? 'translate' : 'review';
  await executeAiAction(tab.id, mode, selectedText);
});

// Chrome 공식 단축키(commands) 이벤트 처리
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate_selection' && command !== 'review_selection') return;
  const mode = command === 'translate_selection' ? 'translate' : 'review';

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id) {
      await triggerShortcutAction(activeTab.id, mode);
    }
  } catch (err) {
    console.error('Command execution error:', err);
  }
});

// 확장 프로그램 내부 메시지 핸들러 (환경설정 열기, 단축키 설정 열기, 재검토 요청)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_OPTIONS') {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    }
    return false;
  }

  if (message.action === 'OPEN_SHORTCUTS') {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    return false;
  }

  if (message.action === 'REFINE_REVIEW') {
    (async () => {
      try {
        const settings = await getSettings();
        const provider = settings.provider || 'gemini';
        const apiKey = getActiveApiKey(settings);
        const model = getActiveModel(settings);

        if (!apiKey || apiKey.trim() === '') {
          sendResponse({
            ok: false,
            error: {
              message: `${getProviderLabel(provider)} API 키가 설정되지 않았습니다. 확장 프로그램 아이콘을 클릭하여 설정(Options)에서 API 키를 입력해 주세요.`
            }
          });
          return;
        }

        const result = await reviewText({
          text: message.originalText || '',
          provider,
          apiKey,
          model,
          sourceLangs: settings.reviewSourceLangs || ['en', 'ko'],
          targetLang: settings.reviewTargetLang || 'ko',
          refinementContext: message.refinementContext || null
        });

        sendResponse({ ok: true, data: result });
      } catch (error) {
        console.error('Refine review execution error:', error);
        sendResponse({
          ok: false,
          error: {
            message: error.message || '재검토 처리 중 오류가 발생했습니다.',
            status: error.status || 0,
            code: error.code || '',
            details: error.details || error.message || ''
          }
        });
      }
    })();
    return true;
  }
});

/**
 * 탭으로 메시지를 안전하게 전달하는 헬퍼 함수
 * (Content Script가 아직 주입되지 않은 경우 동적으로 주입 후 재시도)
 */
async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    try {
      // Content script가 아직 실행되지 않은 탭일 경우 동적 주입 시도
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      // 주입 완료 후 약간의 틱 뒤에 메시지 재전송
      await new Promise(resolve => setTimeout(resolve, 60));
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (injectErr) {
      console.warn('탭으로 메시지 전송 및 스크립트 주입 실패 (보호된 chrome:// URL 등):', injectErr);
      return null;
    }
  }
}
