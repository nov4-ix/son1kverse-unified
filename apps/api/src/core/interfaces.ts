// ─── SON1KVERSE — Core Interfaces ────────────────────────────────────────────
// Contratos que todo módulo debe cumplir.
// El sistema depende de estas interfaces, nunca de implementaciones concretas.

import type {
  AgentContext,
  ArtistProfile,
  CompletionOptions,
  CreativeIntent,
  CreativeResult,
  Feedback,
  MemoryEntry,
  MemoryType,
  OrchestrationRequest,
  ProviderConfig,
  ProviderType,
  RoutingRule,
} from './types.js'

export type { ProviderConfig as IProviderConfig } from './types.js'

import type {
  CreateProfileDTO,
  CreateSessionDTO,
  FeedbackDTO,
  SaveMemoryDTO,
  UpdateProfileDTO,
} from './contracts.js'

// ─── Identity Service ─────────────────────────────────────────────────────────

export interface IIdentityService {
  createProfile(data: CreateProfileDTO): Promise<ArtistProfile>
  updateProfile(id: string, data: UpdateProfileDTO): Promise<ArtistProfile>
  getProfile(id: string): Promise<ArtistProfile>
  getProfileByAlias(alias: string): Promise<ArtistProfile | null>
  evolveFromFeedback(profileId: string, feedback: Feedback): Promise<void>
  deleteProfile(id: string): Promise<void>
}

// ─── Memory Service ───────────────────────────────────────────────────────────

export interface IMemoryService {
  saveMemory(data: SaveMemoryDTO): Promise<MemoryEntry>
  searchContext(query: string, profileId: string, limit?: number): Promise<MemoryEntry[]>
  updateMemory(id: string, score: number): Promise<MemoryEntry>
  getMemoriesByType(profileId: string, type: MemoryType): Promise<MemoryEntry[]>
  consolidate(profileId: string): Promise<void>
  deleteMemory(id: string): Promise<void>
}

// ─── Analysis Service ─────────────────────────────────────────────────────────

export interface IAnalysisService {
  analyze(prompt: string, profile: ArtistProfile): Promise<CreativeIntent>
  detectEmotion(text: string): Promise<string[]>
  inferGenre(prompt: string, profile: ArtistProfile): Promise<string[]>
  detectUrgency(text: string): Promise<'low' | 'medium' | 'high'>
}

// ─── Orchestrator — PIXEL vive aquí ──────────────────────────────────────────

export interface IOrchestrator {
  orchestrate(request: OrchestrationRequest): Promise<CreativeResult>
  processFeedback(feedback: FeedbackDTO): Promise<void>
}

// ─── Agent Interface ──────────────────────────────────────────────────────────

export interface IAgent {
  readonly type:           string
  readonly supportedTypes: string[]

  execute(context: AgentContext): Promise<CreativeResult>
  canHandle(intent: CreativeIntent): boolean
  buildSystemPrompt(profile: ArtistProfile): string
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface IProvider {
  readonly name:            string
  readonly type:            string
  readonly supportedModels: string[]

  complete(
    prompt:  string,
    options?: CompletionOptions,
  ): Promise<string>

  isAvailable(): Promise<boolean>
  configure(config: ProviderConfig): void
}

// ─── Router Interface ─────────────────────────────────────────────────────────

export interface IRouter {
  route(intent: CreativeIntent): {
    agent:    IAgent
    provider: IProvider
    model:    string
  }
  getProvider(type: ProviderType): IProvider | undefined
  addRule(rule: RoutingRule): void
  removeRule(name: string): void
  listRules(): RoutingRule[]
}

// ─── Session Service ──────────────────────────────────────────────────────────

export interface ISessionService {
  createSession(data: CreateSessionDTO): Promise<{ id: string }>
  getSession(id: string): Promise<{ id: string; status: string } | null>
  closeSession(id: string): Promise<void>
}

// ─── Storage Interface — Base para cualquier repositorio ─────────────────────
// Permite migrar de SQLite a Postgres sin tocar la lógica de negocio.

export interface IRepository<T, CreateDTO, UpdateDTO = Partial<CreateDTO>> {
  findById(id: string): Promise<T | null>
  findMany(filter?: Partial<T>): Promise<T[]>
  create(data: CreateDTO): Promise<T>
  update(id: string, data: UpdateDTO): Promise<T>
  delete(id: string): Promise<void>
  count(filter?: Partial<T>): Promise<number>
}

// ─── Event Bus ────────────────────────────────────────────────────────────────

type EventHandler<T = unknown> = (payload: T) => void | Promise<void>

export interface IEventBus {
  emit<T>(event: string, payload: T): void
  on<T>(event: string, handler: EventHandler<T>): void
  off(event: string, handler: EventHandler): void
  once<T>(event: string, handler: EventHandler<T>): void
}

// ─── Embedding Service ────────────────────────────────────────────────────────

export interface IEmbeddingService {
  embed(text: string): Promise<number[]>
  similarity(a: number[], b: number[]): number
  findMostSimilar(query: number[], candidates: Array<{ id: string; embedding: number[] }>, limit?: number): Array<{ id: string; score: number }>
}

// ─── Logger ───────────────────────────────────────────────────────────────────

export interface ILogger {
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, error?: Error, data?: Record<string, unknown>): void
  debug(msg: string, data?: Record<string, unknown>): void
}
