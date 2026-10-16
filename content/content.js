// content/content.js

(function () {
  // 이미 주입된 경우 중복 실행 방지
  if (window.__GEMINI_EXTENSION_INITIALIZED__) return;
  window.__GEMINI_EXTENSION_INITIALIZED__ = true;

  let hostElement = null;
  let shadowRoot = null;
  let isDragging = false;
  let hasUserDragged = false;
  let dragOffset = { x: 0, y: 0 };
  let lastSelectionRect = null;

  // 컨테이너 초기화 (Shadow DOM)
  function initContainer() {
    if (hostElement) return;

    hostElement = document.createElement('div');
    hostElement.id = 'gemini-assistant-extension-host';
    hostElement.style.all = 'initial';
    hostElement.style.position = 'fixed';
    hostElement.style.zIndex = '2147483647';
    hostElement.style.top = '0';
    hostElement.style.left = '0';
    hostElement.style.pointerEvents = 'none';

    document.documentElement.appendChild(hostElement);
    shadowRoot = hostElement.attachShadow({ mode: 'open' });

    // 기본 스타일 주입
    const style = document.createElement('style');
    style.textContent = getStyles();
    shadowRoot.appendChild(style);

    // ESC 키로 닫기
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePopup();
    });
  }

  // 팝업 닫기
  function closePopup() {
    if (!shadowRoot) return;
    const card = shadowRoot.querySelector('.gemini-card');
    if (card) card.remove();
    hasUserDragged = false;
    lastSelectionRect = null;
  }

  // 선택 영역 위치 캡처
  function captureSelectionRect() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        lastSelectionRect = {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height
        };
        return lastSelectionRect;
      }
    }
    return lastSelectionRect;
  }

  // 카드 위치 지능형 계산 (상/하 공간 비교 및 자동 플립)
  function calculateSmartPosition(estimatedHeight = 340) {
    const rect = captureSelectionRect();
    const popupWidth = 460;
    const margin = 16;
    const offset = 10;

    if (rect) {
      // 1. 가로(left) 계산
      let left = rect.left;
      if (left + popupWidth > window.innerWidth - margin) {
        left = window.innerWidth - popupWidth - margin;
      }
      left = Math.max(margin, left);

      // 2. 세로(top) 공간 계산 (위/아래 여백 비교)
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      let top;
      // 아래쪽 공간이 부족하고, 위쪽 공간이 더 넓으면 위쪽에 팝업 표시
      if (spaceBelow < estimatedHeight + 20 && spaceAbove > spaceBelow) {
        top = rect.top - estimatedHeight - offset;
      } else {
        // 기본적으로 아래쪽에 팝업 표시
        top = rect.bottom + offset;
      }

      // 뷰포트 경계 내로 안전하게 클램핑
      top = Math.max(margin, Math.min(window.innerHeight - estimatedHeight - margin, top));

      return { top, left };
    }

    // 선택 영역이 없는 경우 화면 우측 상단 안전 배치
    return { 
      top: 80, 
      left: Math.max(margin, window.innerWidth - popupWidth - 30) 
    };
  }

  // 실제 렌더링 후 뷰포트 내 자동 맞춤 (콘텐츠가 길어져 화면 하단을 벗어나는 현상 원천 방지)
  function fitCardToViewport(card) {
    if (hasUserDragged) return; // 사용자가 직접 원하는 위치로 드래그한 경우 위치 유지

    requestAnimationFrame(() => {
      if (!card || !card.isConnected) return;
      const margin = 16;
      const offset = 10;
      const cardHeight = card.offsetHeight;
      const cardWidth = card.offsetWidth;

      let currentTop = parseFloat(card.style.top) || margin;
      let currentLeft = parseFloat(card.style.left) || margin;

      // 1. 세로(하단) 벗어남 체크
      if (currentTop + cardHeight > window.innerHeight - margin) {
        if (lastSelectionRect) {
          const spaceAbove = lastSelectionRect.top;
          // 선택 영역 위쪽에 충분한 공간이 있는 경우 위쪽으로 자연스럽게 플립
          if (spaceAbove >= cardHeight + offset + margin) {
            currentTop = lastSelectionRect.top - cardHeight - offset;
          } else {
            // 위/아래 모두 꽉 차는 긴 내용일 경우 화면 하단 여백에 맞추어 카드를 위로 끌어올림
            currentTop = window.innerHeight - cardHeight - margin;
          }
        } else {
          currentTop = window.innerHeight - cardHeight - margin;
        }
      }

      // 화면 상단 벗어남 방지
      currentTop = Math.max(margin, currentTop);

      // 2. 가로(우측) 벗어남 체크
      if (currentLeft + cardWidth > window.innerWidth - margin) {
        currentLeft = window.innerWidth - cardWidth - margin;
      }
      currentLeft = Math.max(margin, currentLeft);

      card.style.top = `${Math.round(currentTop)}px`;
      card.style.left = `${Math.round(currentLeft)}px`;
    });
  }

  // 카드 엘리먼트 생성 또는 가져오기
  function getOrCreateCard() {
    initContainer();
    let card = shadowRoot.querySelector('.gemini-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'gemini-card';
      const pos = calculateSmartPosition(320);
      card.style.top = `${pos.top}px`;
      card.style.left = `${pos.left}px`;
      shadowRoot.appendChild(card);
      setupDraggable(card);
    }
    return card;
  }

  // 드래그 기능 바인딩
  function setupDraggable(card) {
    const header = card.querySelector('.gemini-header');
    if (!header) return;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.close-btn')) return;
      isDragging = true;
      hasUserDragged = true; // 사용자가 수동 드래그했음을 표시
      const rect = card.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const newLeft = moveEvent.clientX - dragOffset.x;
        const newTop = moveEvent.clientY - dragOffset.y;
        card.style.left = `${Math.max(10, Math.min(window.innerWidth - card.offsetWidth - 10, newLeft))}px`;
        card.style.top = `${Math.max(10, Math.min(window.innerHeight - card.offsetHeight - 10, newTop))}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // 메시지 수신 핸들러
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'SHOW_LOADING') {
      renderLoading(message.mode, message.selectedText);
    } else if (message.action === 'SHOW_RESULT') {
      renderResult(message.mode, message.data, message.originalText);
    } else if (message.action === 'SHOW_ERROR') {
      renderError(message.error || message.message);
    }
  });

  // 1. 로딩 화면
  function renderLoading(mode, selectedText) {
    const card = getOrCreateCard();
    const modeTitle = mode === 'translate' ? 'AI 문장 번역 중...' : 'AI 문장 검토 중...';
    const previewText = selectedText.length > 100 ? selectedText.slice(0, 100) + '...' : selectedText;

    card.innerHTML = `
      <div class="gemini-header">
        <div class="title-wrap">
          <span class="icon">✨</span>
          <span class="title">${modeTitle}</span>
        </div>
        <button class="close-btn" title="닫기 (Esc)">&times;</button>
      </div>
      <div class="gemini-body loading-view">
        <div class="spinner"></div>
        <p class="status-msg">AI가 문맥을 분석하고 있습니다</p>
        <div class="original-preview">
          <span class="preview-label">선택한 문장:</span>
          <p class="preview-content">"${escapeHtml(previewText)}"</p>
        </div>
      </div>
    `;

    setupCardEvents(card);
  }

  // 2. 결과 화면
  function renderResult(mode, data, originalText) {
    const card = getOrCreateCard();
    const isTranslate = mode === 'translate';
    const modeTitle = isTranslate ? 'AI 번역 결과' : 'AI 문장 검토 & 제안';

    let contentHtml = '';

    if (isTranslate) {
      const alternatives = data.alternatives || [];
      let alternativesHtml = '';
      if (alternatives.length > 0) {
        alternativesHtml = `
          <div class="section">
            <div class="section-label">추천 대안 번역</div>
            <div class="suggestions-list">
              ${alternatives.map((alt, idx) => `
                <div class="suggestion-item">
                  <div class="suggestion-header">
                    <span class="suggestion-tag">${escapeHtml(alt.label || `대안 ${idx + 1}`)}</span>
                    <button class="copy-btn" data-text="${escapeHtml(alt.text)}">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                      <span>복사</span>
                    </button>
                  </div>
                  <div class="suggestion-text">${escapeHtml(alt.text)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      contentHtml = `
        <div class="meta-row">
          <span class="badge lang-badge">감지된 언어: ${escapeHtml(data.detectedLanguage || '자동')}</span>
        </div>
        <div class="section">
          <div class="section-label">원문</div>
          <div class="text-box original-box">${escapeHtml(originalText)}</div>
        </div>
        <div class="section">
          <div class="section-header-row">
            <span class="section-label highlight">메인 번역문</span>
            <button class="copy-btn" data-text="${escapeHtml(data.translatedText || '')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>복사</span>
            </button>
          </div>
          <div class="text-box translated-box">${escapeHtml(data.translatedText || '')}</div>
        </div>
        ${alternativesHtml}
        ${data.notes ? `
          <div class="section">
            <div class="section-label">참고 노트</div>
            <div class="notes-box">${escapeHtml(data.notes)}</div>
          </div>
        ` : ''}
      `;
    } else {
      // 검토 모드
      const suggestions = data.suggestions || [];
      const issues = data.grammarIssues || [];

      let suggestionsHtml = suggestions.map((s, idx) => `
        <div class="suggestion-item">
          <div class="suggestion-header">
            <span class="suggestion-tag">${escapeHtml(s.label || `제안 ${idx + 1}`)}</span>
            <button class="copy-btn" data-text="${escapeHtml(s.text)}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>복사</span>
            </button>
          </div>
          <div class="suggestion-text">${escapeHtml(s.text)}</div>
        </div>
      `).join('');

      let issuesHtml = issues.length > 0
        ? `<ul class="issue-list">${issues.map(iss => `<li>${escapeHtml(iss)}</li>`).join('')}</ul>`
        : '<p class="no-issues">발견된 중대한 문법 오류가 없습니다. 문장이 매우 훌륭합니다!</p>';

      contentHtml = `
        <div class="meta-row">
          <span class="badge lang-badge">감지된 언어: ${escapeHtml(data.detectedLanguage || '자동')}</span>
        </div>
        <div class="section">
          <div class="section-label">원문</div>
          <div class="text-box original-box">${escapeHtml(originalText)}</div>
        </div>
        ${data.inferredIntent ? `
          <div class="section intent-section">
            <div class="section-label">💡 유추된 의도</div>
            <p class="intent-text">${escapeHtml(data.inferredIntent)}</p>
          </div>
        ` : ''}
        <div class="section">
          <div class="section-label highlight">추천 대안 문장</div>
          <div class="suggestions-list">${suggestionsHtml}</div>
        </div>
        <div class="section">
          <div class="section-label">문법 및 표현 분석</div>
          <div class="issues-box">${issuesHtml}</div>
        </div>
        ${data.overallFeedback ? `
          <div class="section">
            <div class="section-label">종합 코멘트</div>
            <div class="notes-box">${escapeHtml(data.overallFeedback)}</div>
          </div>
        ` : ''}
      `;
    }

    card.innerHTML = `
      <div class="gemini-header">
        <div class="title-wrap">
          <span class="icon">✨</span>
          <span class="title">${modeTitle}</span>
        </div>
        <button class="close-btn" title="닫기 (Esc)">&times;</button>
      </div>
      <div class="gemini-body result-view">
        ${contentHtml}
      </div>
    `;

    setupCardEvents(card);
  }

  // 에러 분석 함수 (무료 티어 할당량 초과, 키 오류 등 진단)
  function analyzeError(errorData) {
    let msg = '';
    let status = 0;
    let code = '';
    let details = '';

    if (typeof errorData === 'string') {
      msg = errorData;
      details = errorData;
    } else if (errorData && typeof errorData === 'object') {
      msg = errorData.message || '';
      status = errorData.status || 0;
      code = errorData.code || '';
      details = errorData.details || errorData.message || '';
    }

    const lower = (msg + ' ' + code + ' ' + details).toLowerCase();

    // 1. 무료 할당량 초과 (HTTP 429 / RESOURCE_EXHAUSTED / insufficient_quota / rate_limit)
    if (status === 429 || code === 'RESOURCE_EXHAUSTED' || lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('insufficient_quota')) {
      return {
        badge: 'HTTP 429 · 요청 한도 초과',
        badgeClass: 'badge-quota',
        title: 'API 요청 한도(Quota / Rate Limit)를 초과했습니다',
        desc: '사용 중인 플랜의 분당 요청 한도(RPM) 또는 사용 가능한 토큰이 일시적으로 소진되었습니다.',
        solution: '약 30초~1분 뒤에 다시 시도하시거나, 환경설정에서 다른 모델로 변경해 보세요.',
        details
      };
    }

    // 2. API 키 인증 실패 (HTTP 401, 403, 400 / API_KEY_INVALID / invalid_api_key)
    if (status === 401 || status === 403 || (status === 400 && lower.includes('api_key')) || lower.includes('api key not valid') || lower.includes('api_key_invalid') || lower.includes('invalid_api_key') || lower.includes('incorrect api key')) {
      return {
        badge: 'HTTP ' + (status || 401) + ' · API 키 인증 실패',
        badgeClass: 'badge-danger',
        title: 'API 키가 올바르지 않거나 만료되었습니다',
        desc: '입력된 API 키의 형식이 잘못되었거나 AI 서비스 제공자에서 비활성화된 상태입니다.',
        solution: '확장 프로그램 환경설정에서 API 키를 다시 확인하고 [API 키 검증]을 진행해 주세요.',
        details
      };
    }

    // 3. 모델 미지원 / 찾을 수 없음 (HTTP 404 / model_not_found)
    if (status === 404 || lower.includes('not found') || lower.includes('is not supported') || lower.includes('model_not_found')) {
      return {
        badge: 'HTTP 404 · 모델 미지원',
        badgeClass: 'badge-danger',
        title: '선택한 AI 모델을 찾을 수 없습니다',
        desc: '지정한 모델명이 유효하지 않거나 현재 계정 권한에서 접근할 수 없는 모델입니다.',
        solution: '환경설정에서 사용 가능한 다른 모델을 선택해 주세요.',
        details
      };
    }

    // 4. AI 서버 일시적 과부하 (HTTP 503, 500 / Overloaded / server_error)
    if (status === 503 || status === 500 || lower.includes('overloaded') || lower.includes('unavailable') || lower.includes('server_error')) {
      return {
        badge: 'HTTP ' + (status || 503) + ' · AI 서버 과부하',
        badgeClass: 'badge-warning',
        title: 'AI 서비스 서버에 일시적인 트래픽이 몰렸습니다',
        desc: 'AI 제공자 측의 서버가 일시적인 과부하 상태이거나 점검 중입니다.',
        solution: '잠시 후(약 10~20초 뒤) 다시 시도해 주세요.',
        details
      };
    }

    // 5. API 키 미설정
    if (lower.includes('api 키가 설정되지 않았습니다') || lower.includes('api key is required')) {
      return {
        badge: 'API 키 미등록',
        badgeClass: 'badge-warning',
        title: 'API 키 등록이 필요합니다',
        desc: '확장 프로그램을 사용하려면 먼저 AI API 키를 등록해야 합니다.',
        solution: '아래 [환경설정 열기] 버튼을 눌러 API 키를 등록해 주세요.',
        details
      };
    }

    // 6. 기타 일반 오류
    return {
      badge: status ? `HTTP ${status} 오류` : '요청 실패',
      badgeClass: 'badge-danger',
      title: 'AI 요청 처리 중 오류가 발생했습니다',
      desc: msg || '알 수 없는 오류가 발생했습니다.',
      solution: '네트워크 연결 상태나 환경설정을 확인한 후 다시 시도해 주세요.',
      details
    };
  }

  // 3. 에러 화면
  function renderError(errorData) {
    const card = getOrCreateCard();
    const info = analyzeError(errorData);

    card.innerHTML = `
      <div class="gemini-header error-header">
        <div class="title-wrap">
          <span class="icon">⚠️</span>
          <span class="title">오류 발생</span>
        </div>
        <button class="close-btn" title="닫기 (Esc)">&times;</button>
      </div>
      <div class="gemini-body error-view">
        <div class="error-meta-row">
          <span class="error-badge ${info.badgeClass}">${escapeHtml(info.badge)}</span>
        </div>
        <div class="error-main-box">
          <h4 class="error-title">${escapeHtml(info.title)}</h4>
          <p class="error-desc">${escapeHtml(info.desc)}</p>
        </div>
        
        <div class="error-solution-box">
          <span class="solution-label">💡 권장 해결 방법:</span>
          <p class="solution-text">${escapeHtml(info.solution)}</p>
        </div>

        ${info.details ? `
          <details class="error-details-accordion">
            <summary class="details-summary">원문 오류 로그 보기</summary>
            <pre class="details-code">${escapeHtml(info.details)}</pre>
          </details>
        ` : ''}

        <div class="error-actions">
          <button class="btn btn-primary open-options-btn">⚙️ 환경설정 열기</button>
          <button class="btn btn-secondary close-btn-action">닫기</button>
        </div>
      </div>
    `;

    setupCardEvents(card);
  }

  // 이벤트 바인딩 (닫기, 복사, 드래그, 옵션 열기)
  function setupCardEvents(card) {
    setupDraggable(card);

    // 닫기 버튼들
    card.querySelectorAll('.close-btn, .close-btn-action').forEach(btn => {
      btn.addEventListener('click', closePopup);
    });

    // 환경설정 열기 버튼
    card.querySelectorAll('.open-options-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
      });
    });

    // 복사 버튼
    card.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const textToCopy = btn.getAttribute('data-text');
        if (!textToCopy) return;

        try {
          await navigator.clipboard.writeText(textToCopy);
          const span = btn.querySelector('span');
          const originalText = span ? span.textContent : '';
          if (span) span.textContent = '복사됨!';
          btn.classList.add('copied');
          setTimeout(() => {
            if (span) span.textContent = originalText;
            btn.classList.remove('copied');
          }, 1500);
        } catch (err) {
          console.error('클립보드 복사 실패:', err);
        }
      });
    });

    // 뷰포트 내 최적 위치 자동 클램핑
    fitCardToViewport(card);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Shadow DOM 내부 전용 CSS
  function getStyles() {
    return `
      .gemini-card {
        pointer-events: auto;
        position: fixed;
        width: 460px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        background: #ffffff;
        color: #1f2937;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        border-radius: 14px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08);
        border: 1px solid #e5e7eb;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: gemini-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes gemini-fade-in {
        from { opacity: 0; transform: scale(0.96) translateY(-4px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      .gemini-header {
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #ffffff;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
        user-select: none;
      }

      .gemini-header.error-header {
        background: linear-gradient(135deg, #dc2626, #b91c1c);
      }

      .title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
      }

      .title-wrap .icon {
        font-size: 16px;
      }

      .close-btn {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.85);
        font-size: 20px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        border-radius: 4px;
        transition: background 0.15s, color 0.15s;
      }

      .close-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #ffffff;
      }

      .gemini-body {
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-height: calc(100vh - 32px - 54px);
      }

      /* 스크롤바 */
      .gemini-body::-webkit-scrollbar {
        width: 6px;
      }
      .gemini-body::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 4px;
      }

      /* 로딩 상태 */
      .loading-view {
        align-items: center;
        text-align: center;
        padding: 28px 16px;
      }

      .spinner {
        width: 36px;
        height: 36px;
        border: 3px solid #e2e8f0;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 12px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .status-msg {
        font-weight: 600;
        color: #374151;
        margin: 0 0 12px 0;
      }

      .original-preview {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px 12px;
        width: 100%;
        box-sizing: border-box;
        text-align: left;
      }

      .preview-label {
        font-size: 11px;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        display: block;
        margin-bottom: 4px;
      }

      .preview-content {
        margin: 0;
        color: #334155;
        font-size: 13px;
        font-style: italic;
      }

      /* 메타 뱃지 */
      .meta-row {
        display: flex;
        gap: 8px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 12px;
        background: #eff6ff;
        color: #1d4ed8;
        border: 1px solid #bfdbfe;
      }

      /* 섹션 공통 */
      .section {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .section-header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .section-label {
        font-size: 12px;
        font-weight: 700;
        color: #64748b;
      }

      .section-label.highlight {
        color: #1d4ed8;
      }

      .text-box {
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.5;
        word-break: break-word;
      }

      .original-box {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        color: #475569;
      }

      .translated-box {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        color: #1e3a8a;
        font-size: 14px;
        font-weight: 500;
      }

      .notes-box {
        background: #fafaf9;
        border: 1px solid #e7e5e4;
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 12.5px;
        color: #44403c;
      }

      /* 의도 유추 */
      .intent-section {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 8px;
        padding: 10px 12px;
      }

      .intent-section .section-label {
        color: #15803d;
      }

      .intent-text {
        margin: 4px 0 0 0;
        font-size: 13px;
        color: #166534;
        font-weight: 500;
      }

      /* 제안 목록 */
      .suggestions-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .suggestion-item {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-left: 4px solid #2563eb;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }

      .suggestion-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .suggestion-tag {
        font-size: 11px;
        font-weight: 600;
        color: #1d4ed8;
        background: #dbeafe;
        padding: 2px 6px;
        border-radius: 4px;
      }

      .suggestion-text {
        font-size: 13.5px;
        font-weight: 500;
        color: #0f172a;
        line-height: 1.45;
      }

      /* 문제점 목록 */
      .issues-box {
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 8px;
        padding: 10px 14px;
      }

      .issue-list {
        margin: 0;
        padding-left: 18px;
        color: #92400e;
        font-size: 12.5px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .no-issues {
        margin: 0;
        color: #059669;
        font-size: 12.5px;
        font-weight: 500;
      }

      /* 복사 버튼 */
      .copy-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        color: #475569;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .copy-btn:hover {
        background: #e2e8f0;
        color: #1e293b;
      }

      .copy-btn.copied {
        background: #10b981;
        border-color: #059669;
        color: #ffffff;
      }

      /* 에러 뷰 */
      .error-view {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .error-meta-row {
        display: flex;
      }

      .error-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        letter-spacing: 0.2px;
      }

      .error-badge.badge-quota {
        background: #fff7ed;
        color: #c2410c;
        border: 1px solid #fed7aa;
      }

      .error-badge.badge-danger {
        background: #fef2f2;
        color: #b91c1c;
        border: 1px solid #fecaca;
      }

      .error-badge.badge-warning {
        background: #fefce8;
        color: #a16207;
        border: 1px solid #fef08a;
      }

      .error-main-box {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .error-title {
        margin: 0;
        font-size: 14.5px;
        font-weight: 700;
        color: #0f172a;
        line-height: 1.4;
      }

      .error-desc {
        margin: 0;
        font-size: 13px;
        color: #475569;
        line-height: 1.5;
      }

      .error-solution-box {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-left: 4px solid #2563eb;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .solution-label {
        font-size: 12px;
        font-weight: 700;
        color: #1d4ed8;
      }

      .solution-text {
        margin: 0;
        font-size: 12.5px;
        color: #1e3a8a;
        line-height: 1.45;
      }

      .error-details-accordion {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
      }

      .details-summary {
        cursor: pointer;
        color: #64748b;
        font-weight: 600;
        user-select: none;
        outline: none;
      }

      .details-summary:hover {
        color: #334155;
      }

      .details-code {
        margin: 8px 0 0 0;
        padding: 8px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        color: #b91c1c;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        line-height: 1.4;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 120px;
        overflow-y: auto;
      }

      .error-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
      }

      .btn {
        padding: 7px 14px;
        border-radius: 6px;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.15s ease;
      }

      .btn-primary {
        background: #2563eb;
        color: #ffffff;
      }
      .btn-primary:hover {
        background: #1d4ed8;
      }

      .btn-secondary {
        background: #f1f5f9;
        color: #475569;
        border: 1px solid #cbd5e1;
      }
      .btn-secondary:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
    `;
  }
})();

