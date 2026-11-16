// ─── SON1KVERSE — Base Provider ───────────────────────────────────────────────

import type { IProvider, IProviderConfig } from '../../core/interfaces.js'
import type { CompletionOptions } from '../../core/types.js'
import { ProviderError } from '../../core/errors.js'

export abstract class BaseProvider implements IProvider {
  abstract readonly name:            string
  abstract readonly type:            string
  abstract readonly supportedModels: string[]

  protected config: IProviderConfig = {}

  configure(cfg: IProviderConfig): void {
    this.config = { ...this.config, ...cfg }
  }

  abstract complete(prompt: string, options?: CompletionOptions): Promise<string>
  abstract isAvailable(): Promise<boolean>

  protected handleError(err: unknown, context: string): never {
    const message = err instanceof Error ? err.message : String(err)
    throw new ProviderError(this.name, `${context}: ${message}`)
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    retries = this.config.maxRetries ?? 2,
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        }
      }
    }
    throw lastError
  }
}
