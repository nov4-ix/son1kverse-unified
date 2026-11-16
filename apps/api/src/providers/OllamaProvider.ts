// ─── SON1KVERSE — Ollama Provider ────────────────────────────────────────────
// Modelos locales. Sin costo. Funciona con tu setup en IONOS VPS / local.

import { BaseProvider } from './base/BaseProvider.js'
import type { CompletionOptions } from '../core/types.js'
import { config } from '../config/index.js'

interface OllamaResponse {
  response:    string
  done:        boolean
  error?:      string
}

export class OllamaProvider extends BaseProvider {
  readonly name            = 'ollama'
  readonly type            = 'ollama'
  readonly supportedModels = [
    'qwen2.5:3b',
    'llama3.2:3b',
    'mistral:7b',
    'gemma2:2b',
    'nomic-embed-text',
  ]

  private readonly baseUrl: string
  private readonly model:   string

  constructor(model = 'qwen2.5:3b') {
    super()
    this.baseUrl = config.OLLAMA_BASE_URL
    this.model   = model
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const fullPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt

    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:  options?.model ?? this.model,
          prompt: fullPrompt,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.8,
            num_predict: options?.maxTokens ?? 1000,
          },
        }),
        signal: AbortSignal.timeout(this.config.timeout ?? 60_000),
      })

      if (!res.ok) this.handleError(new Error(`HTTP ${res.status}`), 'complete')

      const data = await res.json() as OllamaResponse
      if (data.error) this.handleError(new Error(data.error), 'complete')
      return data.response
    })
  }

  // Embedding vía Ollama (nomic-embed-text)
  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) this.handleError(new Error(`HTTP ${res.status}`), 'embed')
    const data = await res.json() as { embedding: number[] }
    return data.embedding
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
