'use strict';

// ─── Base provider — OpenAI-compatible Chat Completions API ──
// Used by: OpenAI, DeepSeek, GLM, Kimi, SiliconFlow, etc.
// Streams events via Server-Sent Events (SSE).

class OpenAIProvider {
  constructor(config) {
    this.config = config;
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = config.model || 'gpt-4';
    this.apiKey = config.apiKey || '';
  }

  // Build messages array with system prompt and tool support
  buildMessages(history) {
    const msgs = [];
    // System prompt
    if (this.config.systemPrompt) {
      msgs.push({ role: 'system', content: this.config.systemPrompt });
    }
    // Conversation history
    for (const m of history) {
      if (m.role === 'user' && typeof m.content === 'string') {
        msgs.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        const parts = [];
        if (m.text) parts.push({ type: 'text', text: m.text });
        for (const tc of (m.toolCalls || [])) {
          parts.push({
            type: 'tool_use',
            id: tc.id, name: tc.name, input: tc.input,
          });
        }
        msgs.push({ role: 'assistant', content: parts.length ? parts : m.text || '' });
      } else if (m.role === 'tool_result') {
        msgs.push({
          role: 'tool',
          tool_call_id: m.toolUseId,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
        });
      }
    }
    return msgs;
  }

  // Convert tool definitions from Anthropic format to OpenAI format
  buildTools(defs) {
    if (!defs || !defs.length) return undefined;
    return defs.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} },
      },
    }));
  }

  // Call API with streaming, call event handlers
  async *stream(messages) {
    const body = {
      model: this.model,
      messages: this.buildMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    };

    // Add tools if defined
    if (this.config.tools && this.config.tools.length) {
      body.tools = this.buildTools(this.config.tools);
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall = null;
    let inputTokens = 0, outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);

          // Token usage
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens || 0;
            outputTokens = chunk.usage.completion_tokens || 0;
          }

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            yield { type: 'text_delta', text: delta.content };
          }

          // Tool call start
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined && !currentToolCall) {
                currentToolCall = { id: tc.id || '', name: '', args: '' };
              }
              if (currentToolCall) {
                if (tc.id) currentToolCall.id = tc.id;
                if (tc.function?.name) currentToolCall.name = tc.function.name;
                if (tc.function?.arguments) currentToolCall.args += tc.function.arguments;
              }
            }
          }

          // Finish reason
          const finish = chunk.choices?.[0]?.finish_reason;
          if (finish === 'tool_calls' && currentToolCall) {
            yield { type: 'tool_use', id: currentToolCall.id, name: currentToolCall.name, input: JSON.parse(currentToolCall.args || '{}') };
            currentToolCall = null;
          } else if (finish === 'stop') {
            yield { type: 'done' };
          }
        } catch { /* skip parse errors */ }
      }
    }

    // Flush remaining buffer
    if (currentToolCall && currentToolCall.name) {
      try {
        yield { type: 'tool_use', id: currentToolCall.id, name: currentToolCall.name, input: JSON.parse(currentToolCall.args || '{}') };
      } catch { /* skip */ }
    }

    yield { type: 'usage', inputTokens, outputTokens };
  }
}

module.exports = { OpenAIProvider };
