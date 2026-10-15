// utils/gemini.js
import { SUPPORTED_LANGUAGES } from './storage.js';

function getLanguageName(code) {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
  return lang ? lang.name : code;
}

/**
 * Gemini API를 호출하여 콘텐츠를 생성합니다.
 */
export async function callGemini({ apiKey, model = 'gemini-3.5-flash-lite', contents, systemInstruction = '', responseSchema = null }) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Gemini API 키가 설정되지 않았습니다. 확장 프로그램 설정(Options)에서 API 키를 입력해 주세요.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

  const body = {
    contents: contents,
    generationConfig: {
      temperature: 0.3
    }
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  if (responseSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = responseSchema;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let errorMsg = `API 요청 실패 (HTTP ${response.status})`;
    try {
      const errData = await response.json();
      if (errData.error && errData.error.message) {
        errorMsg = errData.error.message;
      }
    } catch (_) {}
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    throw new Error('Gemini로부터 유효한 응답을 받지 못했습니다.');
  }

  return candidate.content.parts[0].text;
}

/**
 * 번역 수행 함수
 */
export async function translateText({ text, apiKey, model, sourceLangs, targetLang }) {
  const sourceLangNames = (sourceLangs || []).map(getLanguageName).join(', ');
  const targetLangName = getLanguageName(targetLang);

  const systemInstruction = `당신은 최고 수준의 번역 전문가입니다.
사용자가 입력한 텍스트의 언어를 [${sourceLangNames}] 후보 중에서 판별(또는 제3의 언어일 경우 해당 언어 판별)하고, [${targetLangName}]로 자연스럽고 유려하게 번역하세요.
반드시 지정된 JSON 스키마 형식으로만 응답해야 합니다.`;

  const prompt = `번역할 원문:
"""
${text}
"""`;

  const schema = {
    type: "OBJECT",
    properties: {
      detectedLanguage: { type: "STRING", description: "원문의 감지된 언어명" },
      translatedText: { type: "STRING", description: "번역된 최종 문장" },
      notes: { type: "STRING", description: "뉘앙스, 주요 어휘 설명 또는 참고 사항" }
    },
    required: ["detectedLanguage", "translatedText"]
  };

  const responseText = await callGemini({
    apiKey,
    model,
    systemInstruction,
    contents: [{ parts: [{ text: prompt }] }],
    responseSchema: schema
  });

  try {
    return JSON.parse(responseText);
  } catch (err) {
    return {
      detectedLanguage: "자동 감지",
      translatedText: responseText,
      notes: ""
    };
  }
}

/**
 * 문장 검토 및 제안 수행 함수
 */
export async function reviewText({ text, apiKey, model, sourceLangs, targetLang }) {
  const sourceLangNames = (sourceLangs || []).map(getLanguageName).join(', ');
  const targetLangName = getLanguageName(targetLang);

  const systemInstruction = `당신은 탁월한 어학/문법 코치이자 교정(Proofreading) 전문가입니다.
사용자가 제공한 문장은 [${sourceLangNames}] 중 하나일 가능성이 높습니다.
다음 작업을 수행하세요:
1. 문장의 언어를 판별합니다.
2. 문법적 오류(Grammar, Punctuation, Spacing)와 어색한 표현(Awkward phrasing)을 꼼꼼하게 점검합니다.
3. 사용자가 원래 표현하고자 했던 의도(Inferred intent)를 유추합니다.
4. 더 자연스럽고 상황에 어울리는 추천 대안 문장을 2~3개 제안합니다. (예: 자연스러운 일상 표현, 정중한 비즈니스 표현 등)
5. 설명과 피드백은 사용자가 이해하기 쉽도록 [${targetLangName}]로 작성해 주세요.
반드시 지정된 JSON 스키마 형식으로만 응답해야 합니다.`;

  const prompt = `검토할 원문:
"""
${text}
"""`;

  const schema = {
    type: "OBJECT",
    properties: {
      detectedLanguage: { type: "STRING", description: "원문의 감지된 언어명" },
      inferredIntent: { type: "STRING", description: "작성자가 의도한 것으로 유추되는 원래 생각/목적" },
      suggestions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING", description: "제안하는 수정/대안 문장" },
            label: { type: "STRING", description: "문장의 뉘앙스/스타일 (예: 자연스러운 일상 표현, 정중한 비즈니스 표현 등)" }
          },
          required: ["text", "label"]
        },
        description: "추천 대안 문장 목록 (2~3개)"
      },
      grammarIssues: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "발견된 문법/어색한 오류 설명 목록"
      },
      overallFeedback: { type: "STRING", description: "종합적인 평가 및 조언" }
    },
    required: ["detectedLanguage", "inferredIntent", "suggestions", "grammarIssues"]
  };

  const responseText = await callGemini({
    apiKey,
    model,
    systemInstruction,
    contents: [{ parts: [{ text: prompt }] }],
    responseSchema: schema
  });

  try {
    return JSON.parse(responseText);
  } catch (err) {
    return {
      detectedLanguage: "자동 감지",
      inferredIntent: "의도 유추 불가",
      suggestions: [{ text: responseText, label: "기본 결과" }],
      grammarIssues: [],
      overallFeedback: ""
    };
  }
}

