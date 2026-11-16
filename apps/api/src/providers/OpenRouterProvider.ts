// ─── SON1KVERSE — OpenRouter Provider ────────────────────────────────────────
// Acceso a 200+ modelos via OpenRouter. Ya validado con claude-3-haiku.

import { BaseProvider } from './base/BaseProvider.js'
import type { CompletionOptions } from '../core/types.js'
import { config } from '../config/index.js'

interface OpenRouterMessage {
  role:    'user' | 'assistant' | 'system'
  content: string
}

interface OpenRouterResponse {
  choices: Array<{
    message: { content: string }
  }>
  error?: { message: string }
}

export class OpenRouterProvider extends BaseProvider {
  readonly name            = 'openrouter'
  readonly type            = 'openrouter'
  readonly supportedModels = [
    'anthropic/claude-3-haiku',
    'anthropic/claude-3-sonnet',
    'anthropic/claude-3-opus',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'mistralai/mixtral-8x7b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
  ]

  private readonly baseUrl  = 'https://openrouter.ai/api/v1'
  private readonly model: string

  constructor(model?: string) {
    super()
    this.model = model ?? config.PIXEL_DEFAULT_MODEL
    this.config.apiKey = config.OPENROUTER_API_KEY
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('OPENROUTER_API_KEY no configurado')
    }

    const messages: OpenRouterMessage[] = []
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'HTTP-Referer':  'https://son1kverse.com',
          'X-Title':       'SON1KVERSE',
        },
        body: JSON.stringify({
          model:       options?.model ?? this.model,
          messages,
          temperature: options?.temperature ?? 0.8,
          max_tokens:  options?.maxTokens ?? 1000,
        }),
        signal: AbortSignal.timeout(this.config.timeout ?? 30_000),
      })

      if (!res.ok) {
        const err = await res.text()
        this.handleError(new Error(`HTTP ${res.status}: ${err}`), 'complete')
      }

      const data = await res.json() as OpenRouterResponse
      if (data.error) this.handleError(new Error(data.error.message), 'complete')

      const content = data.choices[0]?.message.content
      if (!content) this.handleError(new Error('Empty response'), 'complete')
      return content
    })
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.apiKey) return false
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal:  AbortSignal.timeout(5_000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
