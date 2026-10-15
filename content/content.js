// content/content.js

(function () {
  // 이미 주입된 경우 중복 실행 방지
  if (window.__GEMINI_EXTENSION_INITIALIZED__) return;
  window.__GEMINI_EXTENSION_INITIALIZED__ = true;

  let hostElement = null;
  let shadowRoot = null;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

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
  }

  // 카드 위치 계산 (선택 영역 근처 또는 기본 위치)
  function getInitialPosition() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        let top = rect.bottom + 12;
        let left = rect.left;

        // 화면 밖으로 벗어나지 않도록 방어
        const popupWidth = 460;
        const popupHeight = 350;
        if (left + popupWidth > window.innerWidth) {
          left = Math.max(16, window.innerWidth - popupWidth - 20);
        }
        if (top + popupHeight > window.innerHeight) {
          top = Math.max(16, rect.top - popupHeight - 12);
        }
        return { top: Math.max(16, top), left: Math.max(16, left) };
      }
    }
    // 기본 위치 (우측 상단)
    return { top: 80, left: window.innerWidth - 490 };
  }

  // 카드 엘리먼트 생성 또는 가져오기
  function getOrCreateCard() {
    initContainer();
    let card = shadowRoot.querySelector('.gemini-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'gemini-card';
      const pos = getInitialPosition();
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
      renderError(message.message);
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
        <p class="status-msg">Gemini AI가 문맥을 분석하고 있습니다</p>
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
            <span class="section-label highlight">번역문</span>
            <button class="copy-btn" data-text="${escapeHtml(data.translatedText || '')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>복사</span>
            </button>
          </div>
          <div class="text-box translated-box">${escapeHtml(data.translatedText || '')}</div>
        </div>
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

  // 3. 에러 화면
  function renderError(errorMessage) {
    const card = getOrCreateCard();
    card.innerHTML = `
      <div class="gemini-header error-header">
        <div class="title-wrap">
          <span class="icon">⚠️</span>
          <span class="title">오류 발생</span>
        </div>
        <button class="close-btn" title="닫기 (Esc)">&times;</button>
      </div>
      <div class="gemini-body error-view">
        <p class="error-msg">${escapeHtml(errorMessage)}</p>
        <div class="error-actions">
          <button class="btn btn-secondary close-btn-action">닫기</button>
        </div>
      </div>
    `;

    setupCardEvents(card);
  }

  // 이벤트 바인딩 (닫기, 복사, 드래그)
  function setupCardEvents(card) {
    setupDraggable(card);

    // 닫기 버튼들
    card.querySelectorAll('.close-btn, .close-btn-action').forEach(btn => {
      btn.addEventListener('click', closePopup);
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
        max-height: 80vh;
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
        max-height: calc(80vh - 54px);
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
        padding: 20px 16px;
      }

      .error-msg {
        margin: 0 0 16px 0;
        color: #b91c1c;
        font-size: 13px;
        line-height: 1.5;
        background: #fef2f2;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid #fecaca;
      }

      .error-actions {
        display: flex;
        justify-content: flex-end;
      }

      .btn {
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        border: none;
      }

      .btn-secondary {
        background: #e2e8f0;
        color: #334155;
      }
      .btn-secondary:hover {
        background: #cbd5e1;
      }
    `;
  }
})();

