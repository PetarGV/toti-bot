const ENDPOINT = 'https://api-free.deepl.com/v2/translate';
const DEFAULT_TIMEOUT_MS = 8000;

export class DeeplError extends Error {
  constructor(kind, status, message) {
    super(message);
    this.name = 'DeeplError';
    this.kind = kind;
    this.status = status;
  }
}

export async function translate({ text, targetLang, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const body = new URLSearchParams({ text, target_lang: targetLang });
  let response;

  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new DeeplError('timeout', 0, 'DeepL request timed out');
    }
    throw new DeeplError('network', 0, err?.message || 'Network error');
  }

  if (response.status === 403) {
    throw new DeeplError('auth', 403, 'DeepL rejected the API key');
  }
  if (response.status === 456) {
    throw new DeeplError('quota', 456, 'DeepL quota exceeded');
  }
  if (response.status >= 500) {
    throw new DeeplError('upstream', response.status, `DeepL ${response.status}`);
  }
  if (!response.ok) {
    throw new DeeplError('http', response.status, `DeepL ${response.status}`);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new DeeplError('shape', response.status, 'DeepL response was not valid JSON');
  }

  const first = json?.translations?.[0];
  if (!first || typeof first.text !== 'string') {
    throw new DeeplError('shape', response.status, 'Unexpected DeepL response shape');
  }

  return {
    translation: first.text,
    detectedSourceLang: first.detected_source_language || '',
  };
}
