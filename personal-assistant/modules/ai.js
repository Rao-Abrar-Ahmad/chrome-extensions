export async function* streamAIResponse(prompt, systemPrompt, apiKey, model) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'chrome-extension://personal-assistant',
      'X-Title': 'Personal Assistant'
    },
    body: JSON.stringify({
      model: model,
      stream: true,
      max_tokens: 400,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid API key");
    } else if (response.status === 429) {
      throw new Error("Rate limit exceeded");
    }
    throw new Error(`API error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

    for (const line of lines) {
      const data = line.replace('data: ', '');
      if (data.trim() === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // Ignore malformed chunks
      }
    }
  }
}

export async function generateResponse(question, context, apiKey) {
  const prompt = `Meeting context: ${context}\n\nQuestion: ${question}\n\nProvide a helpful, concise answer:`;
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.3
    })
  });

  const result = await response.json();
  return result.choices[0].message.content;
}

export function buildSystemPrompt(userContext) {
  const base = `You are an AI assistant embedded in a Chrome extension that helps a 
professional during live business calls and meetings.

Your role:
- Provide clear, accurate, concise answers to questions asked by the 
  other person in the meeting.
- Responses must be 3–5 sentences maximum. The user is on a live call 
  and needs to respond in seconds.
- Be direct and factual. Skip preambles like "Great question!" or 
  "Certainly!". Start your answer immediately.
- Write in natural, conversational language — the user may speak 
  your answer aloud.
- If you are unsure, say so briefly rather than guessing.
- No bullet points, no markdown headers, no formatting. Plain prose only.
- Always write from the perspective of the user — "you can", "your 
  store", "in your case".`;

  if (userContext && userContext.trim().length > 0) {
    return `${base}\n\nCurrent meeting context: ${userContext.trim()}`;
  }
  return base;
}

export function buildUserPrompt(contextTranscriptLines, questionText) {
  return `Recent conversation:
${contextTranscriptLines.join('\n')}

Question to answer:
${questionText}

Provide a concise, spoken-language answer the user can give right now.`;
}
