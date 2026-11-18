// utils/gemini.js
import { SUPPORTED_LANGUAGES, TRANSLATE_SOURCE_LANGUAGES } from './storage.js';

function getLanguageName(code) {
  if (code === 'auto') return '언어 자동 감지';
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code) || TRANSLATE_SOURCE_LANGUAGES.find(l => l.code === code);
  return lang ? lang.name : code;
}

/**
 * 텍스트에서 안전하게 JSON을 추출하여 파싱합니다.
 * 추론 모델의 <think>...</think> 블록, 마크다운 코드블록(```json ... ```), 불필요한 줄글이 섞여 있어도 파싱을 성공시킵니다.
 */
function parseJsonSafely(text) {
  if (!text || typeof text !== 'string') return null;

  // 추론(Thinking) 모델이 출력할 수 있는 <think>...</think> 블록 제거
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 1. 순수 JSON 파싱 시도
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // 2. ```json ... ``` 또는 ``` ... ``` 마크다운 블록 추출
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (_) {}
  }

  // 3. 문자열 내부에서 가장 바깥쪽의 { ... } 블록 추출
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const jsonCandidate = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(jsonCandidate);
    } catch (_) {}
  }

  return null;
}

function getRoutedModelIfDifferent(requestedModel, actualModel) {
  if (!actualModel || typeof actualModel !== 'string') return '';
  const reqNorm = (requestedModel || '').trim().toLowerCase().replace(/:free$/, '');
  const actNorm = actualModel.trim().toLowerCase().replace(/:free$/, '');
  if (!actNorm || reqNorm === actNorm) return '';
  return actualModel.trim();
}

/**
 * OpenRouter Chat Completions API를 호출하여 콘텐츠를 생성합니다.
 */
async function callOpenRouter({ apiKey, model = 'openrouter/free', contents, systemInstruction = '', responseSchema = null }) {
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const targetModel = model || 'openrouter/free';
  const isGemma = targetModel.toLowerCase().includes('gemma');

  const userPrompt = contents?.[0]?.parts?.[0]?.text || '';
  let promptWithSchema = userPrompt;
  if (responseSchema) {
    promptWithSchema += `\n\n[IMPORTANT OUTPUT FORMAT]\nDo NOT wrap with markdown, explanation, or chat text. Output MUST be ONLY a single valid raw JSON object matching this schema:\n${JSON.stringify(responseSchema, null, 2)}`;
  }

  const messages = [];
  if (isGemma) {
    // 일부 OpenRouter 상위 공급자(Google AI Studio 등)는 Gemma에서 system role을 거부하므로 user 메시지로 병합
    let combinedPrompt = '';
    if (systemInstruction) {
      combinedPrompt += `[SYSTEM INSTRUCTION]\n${systemInstruction}\n\n`;
    }
    combinedPrompt += `[USER REQUEST]\n${promptWithSchema}`;
    messages.push({ role: 'user', content: combinedPrompt });
  } else {
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: promptWithSchema });
  }

  const body = {
    model: targetModel,
    messages,
    temperature: 0.3
  };

  // 45초 타임아웃 제어
  const controller = new AbortController();
  const timeoutMs = 45000;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://github.com/crencirs/chrome-extension-grammar',
        'X-Title': 'AI Translation and Grammar Reviewer'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    if (fetchErr.name === 'AbortError') {
      const timeoutErr = new Error(`AI 서버 응답 시간 초과 (${timeoutMs / 1000}초 Timeout): ${targetModel} 모델의 응답 생성이 지연되었거나 서버가 응답하지 않습니다. 다른 모델로 변경해 보세요.`);
      timeoutErr.status = 504;
      timeoutErr.code = 'DEADLINE_EXCEEDED';
      throw timeoutErr;
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeoutId);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_) {}

  if (!response.ok || data?.error) {
    const httpStatus = response.ok ? (data?.error?.code || 502) : response.status;
    let errorMsg = `OpenRouter API 요청 실패 (HTTP ${httpStatus})`;
    let errorCode = '';
    let details = '';

    if (data?.error) {
      errorCode = String(data.error.code || '');
      const baseMsg = data.error.message || '';
      const metaParts = [];
      if (data.error.metadata?.provider_name) {
        metaParts.push(`Provider: ${data.error.metadata.provider_name}`);
      }
      if (data.error.metadata?.raw) {
        metaParts.push(
          typeof data.error.metadata.raw === 'string'
            ? data.error.metadata.raw
            : JSON.stringify(data.error.metadata.raw)
        );
      }
      details = [baseMsg, ...metaParts].filter(Boolean).join('\n');
      errorMsg = baseMsg ? `[${httpStatus}] ${baseMsg}` : errorMsg;
    }

    const err = new Error(errorMsg);
    err.status = Number(httpStatus) || response.status || 500;
    err.code = errorCode;
    err.details = details || errorMsg;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string' || content.trim() === '') {
    throw new Error('OpenRouter AI로부터 유효한 응답을 받지 못했습니다.');
  }

  const routedModel = getRoutedModelIfDifferent(targetModel, data?.model);
  return { text: content, routedModel };
}

/**
 * AI API를 호출하여 콘텐츠를 생성합니다 (Google Gemini / OpenRouter 지원).
 * - Gemma 모델은 systemInstruction과 responseSchema를 지원하지 않으므로 자동으로 프롬프트 결합 방식으로 폴백합니다.
 * - 45초 타임아웃을 적용하여 무한 대기를 방지합니다.
 */
export async function callGemini({ provider = 'gemini', apiKey, model = 'gemini-3.5-flash-lite', contents, systemInstruction = '', responseSchema = null, returnMeta = false }) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('API 키가 설정되지 않았습니다. 확장 프로그램 설정(Options)에서 API 키를 입력해 주세요.');
  }

  const startTime = Date.now();

  if (provider === 'openrouter') {
    const res = await callOpenRouter({
      apiKey,
      model: model || 'openrouter/free',
      contents,
      systemInstruction,
      responseSchema
    });
    const elapsedMs = Date.now() - startTime;
    return returnMeta ? { ...res, elapsedMs } : res.text;
  }

  const targetModel = model || 'gemini-3.5-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey.trim()}`;
  const isGemma = targetModel.toLowerCase().includes('gemma');

  let finalContents = contents;
  const body = {
    generationConfig: {
      temperature: 0.3
    }
  };

  // Gemma 모델인 경우: systemInstruction과 responseSchema 미지원 -> 프롬프트로 병합
  if (isGemma) {
    let combinedPrompt = '';
    if (systemInstruction) {
      combinedPrompt += `[SYSTEM INSTRUCTION]\n${systemInstruction}\n\n`;
    }
    const userPrompt = contents?.[0]?.parts?.[0]?.text || '';
    combinedPrompt += `[USER REQUEST]\n${userPrompt}\n\n`;
    if (responseSchema) {
      combinedPrompt += `[IMPORTANT OUTPUT FORMAT]\nDo NOT wrap with markdown, explanation, or chat text. Output MUST be ONLY a single valid raw JSON object matching this schema:\n${JSON.stringify(responseSchema, null, 2)}`;
    }

    finalContents = [{ parts: [{ text: combinedPrompt }] }];
  } else {
    // 일반 Gemini 모델인 경우: 표준 Structured Outputs 및 systemInstruction 사용
    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    if (responseSchema) {
      body.generationConfig.responseMimeType = 'application/json';
      body.generationConfig.responseSchema = responseSchema;
    }
  }

  body.contents = finalContents;

  // 45초 타임아웃 제어 (Gemma 대형 모델 등 무한 대기 방지)
  const controller = new AbortController();
  const timeoutMs = 45000;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    if (fetchErr.name === 'AbortError') {
      const timeoutErr = new Error(`AI 서버 응답 시간 초과 (${timeoutMs / 1000}초 Timeout): ${targetModel} 모델의 크기가 커서 응답 생성이 지연되었거나 서버가 응답하지 않습니다. 다른 경량 모델(예: gemini-3.5-flash-lite)로 변경해 보세요.`);
      timeoutErr.status = 504;
      timeoutErr.code = 'DEADLINE_EXCEEDED';
      throw timeoutErr;
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorMsg = `API 요청 실패 (HTTP ${response.status})`;
    let errorCode = '';
    let details = '';

    try {
      const errData = await response.json();
      if (errData.error) {
        errorCode = errData.error.status || '';
        details = errData.error.message || '';
        errorMsg = details ? `[${response.status}] ${details}` : errorMsg;
      }
    } catch (_) {}

    const err = new Error(errorMsg);
    err.status = response.status;
    err.code = errorCode;
    err.details = details || errorMsg;
    throw err;
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    throw new Error('AI로부터 유효한 응답을 받지 못했습니다.');
  }

  const text = candidate.content.parts[0].text;
  const elapsedMs = Date.now() - startTime;
  return returnMeta ? { text, routedModel: '', elapsedMs } : text;
}

export const callAI = callGemini;

/**
 * 번역 수행 함수
 */
export async function translateText({ text, provider = 'gemini', apiKey, model, sourceLang = 'auto', targetLang = 'ko', explanationLang = 'ko' }) {
  const targetLangName = getLanguageName(targetLang);
  const explanationLangName = getLanguageName(explanationLang);
  const isAuto = !sourceLang || sourceLang === 'auto';
  const sourceLangName = isAuto ? '자동 감지' : getLanguageName(sourceLang);

  const systemInstruction = `당신은 최고 수준의 전문 번역가입니다.
${isAuto 
  ? `사용자가 입력한 문장의 언어를 자동으로 식별하고, [${targetLangName}]로 자연스럽고 정확하게 번역하세요.` 
  : `입력된 [${sourceLangName}] 문장을 [${targetLangName}]로 자연스럽고 정확하게 번역하세요.`}

[매우 중요한 언어 출력 규칙]:
1. 번역 결과 문장 ([${targetLangName}]로 작성):
   - "translatedText"는 [${targetLangName}]로 가장 자연스럽게 번역된 메인 완성 문장입니다.
   - "alternatives"는 상황/문맥별 추천 대안 번역 문장 목록(2~3개)입니다. 각 대안의 "text"는 [${targetLangName}]로 작성되어야 합니다.
2. 설명 및 라벨 언어 (반드시 100% [${explanationLangName}]로만 작성):
   - "detectedLanguage"(감지된 언어명)는 [${explanationLangName}]로 표기하세요.
   - "notes"(어휘 팁, 문맥/뉘앙스 차이 설명)는 반드시 100% [${explanationLangName}]로만 작성하세요.
   - "alternatives" 목록의 각 대안 "label"(예: "자연스러운 일상 구어체", "정중한 비즈니스 표현", "직역에 가까운 표현" 등)은 반드시 100% [${explanationLangName}]로만 작성하세요.
3. 반드시 지정된 JSON 스키마 형식으로만 응답해야 합니다.`;

  const prompt = `번역할 원문:
"""
${text}
"""

[주의]: notes와 alternative의 label 설명은 반드시 [${explanationLangName}]로 작성해야 합니다.`;

  const schema = {
    type: "OBJECT",
    properties: {
      detectedLanguage: { 
        type: "STRING", 
        description: `원문의 언어명 (반드시 ${explanationLangName}로 표기)` 
      },
      translatedText: { 
        type: "STRING", 
        description: `메인 번역 결과 문장 (${targetLangName})` 
      },
      alternatives: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING", description: `추천 대안 번역 문장 (${targetLangName})` },
            label: { type: "STRING", description: `문장 스타일/뉘앙스 라벨 (반드시 ${explanationLangName}로 작성, 예: 일상 구어체, 정중한 비즈니스 표현)` }
          },
          required: ["text", "label"]
        },
        description: "상황별 추천 대안 번역 문장 목록 (2~3개)"
      },
      notes: { 
        type: "STRING", 
        description: `추가 설명, 뉘앙스 차이 및 어휘 팁 (반드시 100% ${explanationLangName}로 작성할 것)` 
      }
    },
    required: ["detectedLanguage", "translatedText", "alternatives"]
  };

  const { text: responseText, routedModel, elapsedMs } = await callGemini({
    provider,
    apiKey,
    model,
    systemInstruction,
    contents: [{ parts: [{ text: prompt }] }],
    responseSchema: schema,
    returnMeta: true
  });

  const parsed = parseJsonSafely(responseText);
  if (parsed && parsed.translatedText) {
    return { ...parsed, usedModel: routedModel || '', elapsedMs };
  }

  return {
    detectedLanguage: "자동 감지",
    translatedText: responseText,
    alternatives: [],
    notes: "",
    usedModel: routedModel || '',
    elapsedMs
  };
}

/**
 * 문장 검토 및 제안 수행 함수
 */
export async function reviewText({ text, provider = 'gemini', apiKey, model, sourceLangs, targetLang }) {
  const sourceLangNames = (sourceLangs || []).map(getLanguageName).join(', ');
  const targetLangName = getLanguageName(targetLang);

  const systemInstruction = `당신은 탁월한 어학/문법 코치이자 원어민 수준의 교정(Proofreading) 전문가입니다.
사용자가 제공한 원문은 [${sourceLangNames}] 중 하나일 가능성이 높습니다.

[CRITICAL LANGUAGE REQUIREMENT - 반드시 엄격히 준수]:
1. 설명 출력 언어: "inferredIntent"(유추된 의도), "grammarIssues"(문법 및 표현 분석), "overallFeedback"(종합 코멘트), "suggestions"의 "label"(문장 스타일 라벨)은 원문 언어가 무엇이든 관계없이 **반드시 100% [${targetLangName}]로만 작성**하십시오. 절대로 영어 등 다른 언어로 설명하지 마십시오.
2. 교정 제안 문장: "suggestions" 배열 내부의 "text"는 사용자가 원래 표현하고자 했던 언어로 가장 자연스럽고 세련되게 다듬은 완성된 문장이어야 합니다.
3. "detectedLanguage"는 원문의 감지된 언어명을 [${targetLangName}]로 작성하세요.

수행할 작업:
1. 문장의 언어를 판별합니다.
2. 문법적 오류(Grammar, Spacing, Spelling)와 부자연스러운 어색한 표현(Awkward phrasing)을 꼼꼼하게 점검하고, 그 원인과 교정 이유를 [${targetLangName}]로 상세히 서술합니다.
3. 사용자가 원래 전달하고자 했던 생각/의도(Inferred intent)를 정확히 파악하여 [${targetLangName}]로 서술합니다.
4. 상황과 뉘앙스에 맞춘 추천 대안 문장을 2~3개 제안하고, 각 대안의 톤/상황을 나타내는 label(예: "자연스러운 일상 표현", "정중한 비즈니스 표현" 등)을 [${targetLangName}]로 작성합니다.
5. 학습과 실사용에 도움을 주는 종합 피드백을 [${targetLangName}]로 제공합니다.

반드시 지정된 JSON 스키마 형식으로만 응답해야 합니다.`;

  const prompt = `검토할 원문:
"""
${text}
"""

[주의]: inferredIntent, grammarIssues, overallFeedback, suggestion label의 모든 설명 텍스트는 반드시 [${targetLangName}]로 작성해야 합니다.`;

  const schema = {
    type: "OBJECT",
    properties: {
      detectedLanguage: { 
        type: "STRING", 
        description: `원문의 언어명 (반드시 ${targetLangName}로 표기)` 
      },
      inferredIntent: { 
        type: "STRING", 
        description: `작성자가 원래 표현하고자 한 의도 요약 (반드시 100% ${targetLangName}로 작성할 것)` 
      },
      suggestions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING", description: "교정/제안된 문장" },
            label: { type: "STRING", description: `문장 스타일/뉘앙스 라벨 (반드시 ${targetLangName}로 작성, 예: 정중한 비즈니스 표현)` }
          },
          required: ["text", "label"]
        },
        description: "추천 대안 문장 목록 (2~3개)"
      },
      grammarIssues: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: `발견된 문법/어색한 표현 오류 및 수정 이유 설명 목록 (반드시 100% ${targetLangName}로 작성할 것)`
      },
      overallFeedback: { 
        type: "STRING", 
        description: `종합 평가 및 조언 (반드시 100% ${targetLangName}로 작성할 것)` 
      }
    },
    required: ["detectedLanguage", "inferredIntent", "suggestions", "grammarIssues"]
  };

  const { text: responseText, routedModel, elapsedMs } = await callGemini({
    provider,
    apiKey,
    model,
    systemInstruction,
    contents: [{ parts: [{ text: prompt }] }],
    responseSchema: schema,
    returnMeta: true
  });

  const parsed = parseJsonSafely(responseText);
  if (parsed && parsed.suggestions) {
    return { ...parsed, usedModel: routedModel || '', elapsedMs };
  }

  return {
    detectedLanguage: "자동 감지",
    inferredIntent: "의도 유추 불가",
    suggestions: [{ text: responseText, label: "기본 결과" }],
    grammarIssues: [],
    overallFeedback: "",
    usedModel: routedModel || '',
    elapsedMs
  };
}
