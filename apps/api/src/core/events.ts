// ─── SON1KVERSE — Event Bus ───────────────────────────────────────────────────

import type { AgentType, ArtistProfile, CreativeIntent, CreativeResult, PixelMoodId, ProviderType } from './types.js'
import { logger } from '../lib/logger.js'

export enum SystemEvent {
  ORCHESTRATION_STARTED   = 'orchestration:started',
  ORCHESTRATION_COMPLETED = 'orchestration:completed',
  ORCHESTRATION_FAILED    = 'orchestration:failed',
  AGENT_SELECTED          = 'agent:selected',
  AGENT_EXECUTED          = 'agent:executed',
  AGENT_FAILED            = 'agent:failed',
  PROVIDER_CALLED         = 'provider:called',
  PROVIDER_RESPONDED      = 'provider:responded',
  PROVIDER_FAILED         = 'provider:failed',
  MEMORY_SAVED            = 'memory:saved',
  MEMORY_SEARCHED         = 'memory:searched',
  MEMORY_CONSOLIDATED     = 'memory:consolidated',
  PROFILE_CREATED         = 'profile:created',
  PROFILE_UPDATED         = 'profile:updated',
  PROFILE_EVOLVED         = 'profile:evolved',
  FEEDBACK_RECEIVED       = 'feedback:received',
  INTENT_ANALYZED         = 'intent:analyzed',
}

// ─── Event Payloads ───────────────────────────────────────────────────────────

export type OrchestrationStartedPayload = {
  sessionId:  string
  profileId:  string
  prompt:     string
  timestamp:  Date
}

export type OrchestrationCompletedPayload = {
  sessionId:  string
  result:     CreativeResult
  durationMs: number
  timestamp:  Date
}

export type OrchestrationFailedPayload = {
  sessionId: string
  error:     string
  prompt:    string
  timestamp: Date
}

export type AgentSelectedPayload = {
  sessionId:    string
  agentType:    AgentType
  providerType: ProviderType
  model:        string
  intent:       CreativeIntent
  personality?: PixelMoodId | undefined
}

export type MemorySavedPayload = {
  memoryId:  string
  profileId: string
  type:      string
  timestamp: Date
}

export type FeedbackReceivedPayload = {
  artifactId: string
  score:      number
  note?:      string
  timestamp:  Date
}

export type ProfileEvolvedPayload = {
  profileId:     string
  changedFields: (keyof ArtistProfile)[]
  timestamp:     Date
}

// ─── EventBus ─────────────────────────────────────────────────────────────────

type Handler<T = unknown> = (payload: T) => void | Promise<void>

export class EventBus {
  private static instance: EventBus
  private readonly handlers: Map<string, Set<Handler>> = new Map()

  static getInstance(): EventBus {
    if (!EventBus.instance) EventBus.instance = new EventBus()
    return EventBus.instance
  }

  emit<T>(event: SystemEvent | string, payload: T): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const handler of set) {
      Promise.resolve(handler(payload)).catch((err) =>
        logger.error({ err, event }, 'EventBus handler error'),
      )
    }
  }

  on<T>(event: SystemEvent | string, handler: Handler<T>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler as Handler)
  }

  off(event: SystemEvent | string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler)
  }

  once<T>(event: SystemEvent | string, handler: Handler<T>): void {
    const wrapper: Handler<T> = (payload) => {
      this.off(event, wrapper as Handler)
      return handler(payload)
    }
    this.on(event, wrapper)
  }

  clear(event?: string): void {
    if (event) this.handlers.delete(event)
    else this.handlers.clear()
  }
}

export const eventBus = EventBus.getInstance()
