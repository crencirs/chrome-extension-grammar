// background/service-worker.js
import { getSettings } from '../utils/storage.js';
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

// 컨텍스트 메뉴 클릭 이벤트 처리
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  const selectedText = (info.selectionText || '').trim();
  if (!selectedText) return;

  const mode = info.menuItemId === 'translate_selection' ? 'translate' : 'review';

  try {
    // 1. 활성 탭에 로딩 UI 띄우기 요청
    await sendMessageToTab(tab.id, {
      action: 'SHOW_LOADING',
      mode,
      selectedText
    });

    // 2. 설정 정보 가져오기
    const settings = await getSettings();

    if (!settings.apiKey || settings.apiKey.trim() === '') {
      await sendMessageToTab(tab.id, {
        action: 'SHOW_ERROR',
        message: 'API 키가 설정되지 않았습니다. 확장 프로그램 아이콘을 클릭하여 설정(Options)에서 API 키를 입력해 주세요.'
      });
      return;
    }

    // 3. AI 작업 수행
    let result;
    if (mode === 'translate') {
      result = await translateText({
        text: selectedText,
        apiKey: settings.apiKey,
        model: settings.model,
        sourceLang: settings.translateSourceLang || 'auto',
        targetLang: settings.translateTargetLang || 'ko',
        explanationLang: settings.translateExplanationLang || 'ko'
      });
    } else {
      result = await reviewText({
        text: selectedText,
        apiKey: settings.apiKey,
        model: settings.model,
        sourceLangs: settings.reviewSourceLangs || ['en', 'ko'],
        targetLang: settings.reviewTargetLang || 'ko'
      });
    }

    // 4. 활성 탭에 결과 렌더링 요청
    await sendMessageToTab(tab.id, {
      action: 'SHOW_RESULT',
      mode,
      data: result,
      originalText: selectedText
    });

  } catch (error) {
    console.error('Service worker execution error:', error);
    await sendMessageToTab(tab.id, {
      action: 'SHOW_ERROR',
      error: {
        message: error.message || '처리 중 오류가 발생했습니다.',
        status: error.status || 0,
        code: error.code || '',
        details: error.details || error.message || ''
      }
    });
  }
});

// 확장 프로그램 내부 메시지 핸들러 (환경설정 열기 등)
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'OPEN_OPTIONS') {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    }
  }
});

/**
 * 탭으로 메시지를 안전하게 전달하는 헬퍼 함수
 * (Content Script가 아직 주입되지 않은 경우 동적으로 주입 후 재시도)
 */
async function sendMessageToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    try {
      // Content script가 아직 실행되지 않은 탭일 경우 동적 주입 시도
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      // 주입 완료 후 약간의 틱 뒤에 메시지 재전송
      await new Promise(resolve => setTimeout(resolve, 60));
      await chrome.tabs.sendMessage(tabId, message);
    } catch (injectErr) {
      console.warn('탭으로 메시지 전송 및 스크립트 주입 실패 (보호된 chrome:// URL 등):', injectErr);
    }
  }
}
