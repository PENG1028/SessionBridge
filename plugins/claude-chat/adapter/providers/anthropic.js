'use strict';

// ─── Anthropic Messages API provider ──

class AnthropicProvider {
  constructor(config) {
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.model = config.model || 'claude-sonnet-4-6';
    this.apiKey = config.apiKey || '';
    this.apiVersion = config.apiVersion || '2023-06-01';
    this.maxTokens = config.maxTokens || 8192;
    this.extendedThinking = config.extendedThinking || false;
    this.maxThinkingTokens = config.maxThinkingTokens || 16000;
  }

  buildMessages(history) {
    const msgs = [];
    for (const m of history) {
      if (m.role === 'assistant') {
        const content = [];
        if (m.text) content.push({ type: 'text', text: m.text });
        for (const tc of (m.toolCalls || [])) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
        msgs.push({ role: 'assistant', content: content.length ? content : m.text });
      } else if (m.role === 'tool_result') {
        msgs.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.toolUseId, content: m.content || '' }],
        });
      } else {
        msgs.push({ role: 'user', content: m.content || m.text || '' });
      }
    }
    return msgs;
  }

  buildTools(defs) {
    if (!defs?.length) return undefined;
    return defs.map(t => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.input_schema || { type: 'object', properties: {} },
    }));
  }

  async *stream(messages, systemPrompt) {
    const body = {
      model: this.model,
      messages: this.buildMessages(messages),
      max_tokens: this.maxTokens,
      stream: true,
    };
    if (systemPrompt) body.system = systemPrompt;
    const tools = this.buildTools(globalThis.__adapterTools);
    if (tools) body.tools = tools;

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let eventBuf = '', eventType = '';
    let inputTokens = 0, outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      eventBuf += decoder.decode(value, { stream: true });
      const lines = eventBuf.split('\n');
      eventBuf = lines.pop() || '';

      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('event: ')) {
          eventType = t.slice(7).trim();
        } else if (t.startsWith('data: ')) {
          const data = t.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const ev = JSON.parse(data);
            const yields = this._processEvent(ev, eventType);
            for (const y of yields) yield y;
            if (ev.type === 'message_start' && ev.message?.usage) {
              inputTokens = ev.message.usage.input_tokens || 0;
            }
            if (ev.type === 'message_delta' && ev.usage) {
              outputTokens = ev.usage.output_tokens || 0;
            }
          } catch { /* skip parse errors */ }
        }
      }
    }

    yield { type: 'usage', inputTokens, outputTokens };
  }

  _processEvent(event, eventType) {
    const results = [];
    switch (eventType) {
      case 'content_block_start': {
        const cb = event.content_block;
        if (cb?.type === 'text') {
          results.push({ type: 'text_delta', text: cb.text || '' });
        } else if (cb?.type === 'thinking') {
          results.push({ type: 'thinking_start' });
          if (cb.thinking) results.push({ type: 'thinking_delta', thinking: cb.thinking });
        } else if (cb?.type === 'tool_use') {
          results.push({ type: 'tool_use', id: cb.id, name: cb.name, input: cb.input || {} });
        }
        break;
      }
      case 'content_block_delta': {
        const d = event.delta;
        if (d?.type === 'text_delta') {
          results.push({ type: 'text_delta', text: d.text || '' });
        } else if (d?.type === 'thinking_delta') {
          results.push({ type: 'thinking_delta', thinking: d.thinking || '' });
        }
        break;
      }
      case 'message_stop': {
        results.push({ type: 'done' });
        break;
      }
      case 'message_delta': {
        if (event.delta?.stop_reason === 'tool_use') {
          results.push({ type: 'need_tool_result' });
        }
        break;
      }
    }
    return results;
  }
}

module.exports = { AnthropicProvider };
