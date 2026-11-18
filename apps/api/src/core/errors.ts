// ─── SON1KVERSE — Core Errors ─────────────────────────────────────────────────

export class Son1kverseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'Son1kverseError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ProfileNotFoundError extends Son1kverseError {
  constructor(id: string) {
    super(`Artist profile not found: ${id}`, 'PROFILE_NOT_FOUND', 404)
  }
}

export class ProfileAlreadyExistsError extends Son1kverseError {
  constructor(alias: string) {
    super(`Profile '${alias}' already exists`, 'PROFILE_EXISTS', 409)
  }
}

export class MemoryNotFoundError extends Son1kverseError {
  constructor(id: string) {
    super(`Memory entry not found: ${id}`, 'MEMORY_NOT_FOUND', 404)
  }
}

export class SessionNotFoundError extends Son1kverseError {
  constructor(id: string) {
    super(`Session not found: ${id}`, 'SESSION_NOT_FOUND', 404)
  }
}

export class SessionNotActiveError extends Son1kverseError {
  constructor(id: string) {
    super(`Session is not active: ${id}`, 'SESSION_NOT_ACTIVE', 409)
  }
}

export class ArtifactNotFoundError extends Son1kverseError {
  constructor(id: string) {
    super(`Artifact not found: ${id}`, 'ARTIFACT_NOT_FOUND', 404)
  }
}

export class AnalysisFailedError extends Son1kverseError {
  constructor(reason: string) {
    super(`Intent analysis failed: ${reason}`, 'ANALYSIS_FAILED', 422)
  }
}

export class AgentExecutionError extends Son1kverseError {
  constructor(agentType: string, reason: string) {
    super(`Agent '${agentType}' failed: ${reason}`, 'AGENT_EXECUTION_FAILED', 500)
  }
}

export class ProviderError extends Son1kverseError {
  constructor(provider: string, reason: string) {
    super(`Provider '${provider}' error: ${reason}`, 'PROVIDER_ERROR', 502)
  }
}

export class ProviderUnavailableError extends Son1kverseError {
  constructor(provider: string) {
    super(`Provider '${provider}' is unavailable`, 'PROVIDER_UNAVAILABLE', 503)
  }
}

export class NoAgentAvailableError extends Son1kverseError {
  constructor(intentType: string) {
    super(`No agent available for: ${intentType}`, 'NO_AGENT_AVAILABLE', 422)
  }
}

export class ValidationError extends Son1kverseError {
  constructor(details: unknown) {
    super('Validation failed', 'VALIDATION_ERROR', 400, details)
  }
}

export class UnauthorizedError extends Son1kverseError {
  constructor() {
    super('Unauthorized', 'UNAUTHORIZED', 401)
  }
}

export class UserAlreadyExistsError extends Son1kverseError {
  constructor(field: 'email' | 'alias', value: string) {
    super(`User ${field} already in use: ${value}`, 'USER_ALREADY_EXISTS', 409)
  }
}

export class InvalidCredentialsError extends Son1kverseError {
  constructor() {
    super('Invalid email or password', 'INVALID_CREDENTIALS', 401)
  }
}

export class ForbiddenError extends Son1kverseError {
  constructor(message = 'No tienes acceso a este recurso') {
    super(message, 'FORBIDDEN', 403)
  }
}

export class NotFoundError extends Son1kverseError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 'NOT_FOUND', 404)
  }
}

export class QuotaExceededError extends Son1kverseError {
  constructor(limit: number) {
    super(
      `Cuota agotada: ${limit} generaciones por mes`,
      'QUOTA_EXCEEDED',
      429,
      { limit },
    )
  }
}
