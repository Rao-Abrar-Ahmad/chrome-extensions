import { pipeline, env } from '@xenova/transformers';

// Configure Transformer.js for Chrome extension environment BEFORE any operations
env.remoteHost = ''; // Empty string instead of null
env.remotePathTemplate = 'https://huggingface.co/{model}/resolve/main/{file}';
env.allowLocalModels = false;
env.useCache = true;

let textGenerator = null;
let chromeAI = null;

// Check if Chrome's built-in AI is available
async function checkChromeAI() {
  try {
    // Check if Chrome AI APIs exist and are accessible
    if (typeof chrome !== 'undefined' &&
        chrome.ai &&
        chrome.ai.languageModel &&
        typeof chrome.ai.languageModel.create === 'function') {

      console.log("[AI] Chrome AI APIs detected, attempting to create language model...");
      chromeAI = await chrome.ai.languageModel.create();
      console.log("[AI] Chrome built-in AI successfully initialized");
      return true;
    } else {
      console.log("[AI] Chrome AI APIs not available in this browser version");
      return false;
    }
  } catch (error) {
    console.warn("[AI] Chrome built-in AI initialization failed:", error.message);
    console.log("[AI] Falling back to Transformer.js");
    return false;
  }
}

async function getTextGenerator() {
  if (!textGenerator) {
    console.log("[AI] Loading text generation model...");

    // First try Chrome's built-in AI
    const chromeAIAvailable = await checkChromeAI();
    if (chromeAIAvailable) {
      console.log("[AI] Using Chrome built-in AI");
      return chromeAI;
    }

    // Fallback to Transformer.js
    try {
      console.log("[AI] Chrome AI not available, loading Transformer.js model...");
      textGenerator = await pipeline('text-generation', 'Xenova/gpt2');
      console.log("[AI] Transformer.js text generation model loaded successfully");
    } catch (error) {
      console.error("[AI] Failed to load Transformer.js text generation model:", error);
      throw new Error(`Model loading failed: ${error.message}`);
    }
  }
  return textGenerator;
}

export async function* streamAIResponse(prompt, systemPrompt, apiKey, model) {
  try {
    const generator = await getTextGenerator();

    // Combine system prompt and user prompt
    const fullPrompt = `${systemPrompt}\n\n${prompt}\n\nAnswer:`;

    if (chromeAI && generator === chromeAI) {
      // Use Chrome built-in AI
      console.log("[AI] Generating response with Chrome built-in AI...");
      const response = await chromeAI.prompt(fullPrompt);

      // Simulate streaming by yielding words one by one
      const words = response.split(' ');
      for (const word of words) {
        yield word + ' ';
        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } else {
      // Use Transformer.js
      console.log("[AI] Generating response with Transformer.js...");
      const output = await generator(fullPrompt, {
        max_new_tokens: 100,
        temperature: 0.3,
        do_sample: true,
        pad_token_id: generator.tokenizer.eos_token_id,
        eos_token_id: generator.tokenizer.eos_token_id,
      });

      const generatedText = output[0].generated_text.replace(fullPrompt, '').trim();

      // Simulate streaming by yielding words one by one
      const words = generatedText.split(' ');
      for (const word of words) {
        yield word + ' ';
        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

  } catch (error) {
    console.error("[AI] Local text generation failed:", error);

    // Fallback: provide a simple generic response
    console.log("[AI] Using fallback response due to AI failure");
    const fallbackResponse = "I'm sorry, I couldn't generate a response right now. Please try again.";
    const words = fallbackResponse.split(' ');
    for (const word of words) {
      yield word + ' ';
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

export async function generateResponse(question, context, apiKey) {
  try {
    const generator = await getTextGenerator();

    const prompt = `Meeting context: ${context}\n\nQuestion: ${question}\n\nProvide a helpful, concise answer:`;

    if (chromeAI && generator === chromeAI) {
      // Use Chrome built-in AI
      console.log("[AI] Generating response with Chrome built-in AI...");
      const response = await chromeAI.prompt(prompt);
      return response.trim();
    } else {
      // Use Transformer.js
      console.log("[AI] Generating response with Transformer.js...");
      const output = await generator(prompt, {
        max_new_tokens: 150,
        temperature: 0.3,
        do_sample: true,
        pad_token_id: generator.tokenizer.eos_token_id,
        eos_token_id: generator.tokenizer.eos_token_id,
      });

      const generatedText = output[0].generated_text.replace(prompt, '').trim();

      // Clean up the response - remove any trailing incomplete sentences
      const sentences = generatedText.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const cleanResponse = sentences.slice(0, 2).join('. ').trim();

      return cleanResponse || generatedText.split('\n')[0].trim();
    }

  } catch (error) {
    console.error("[AI] Local response generation failed:", error);

    // Fallback: provide a simple generic response
    console.log("[AI] Using fallback response due to AI failure");
    return "I'm sorry, I couldn't generate a response right now. Please try again or check your connection.";
  }
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
