// ─── SON1KVERSE — Identity Service ───────────────────────────────────────────

import type { IIdentityService } from '../core/interfaces.js'
import type { ArtistProfile, Feedback } from '../core/types.js'
import type { CreateProfileDTO, UpdateProfileDTO } from '../core/contracts.js'
import { ProfileRepository } from '../storage/repositories/ProfileRepository.js'
import { prisma } from '../storage/client.js'
import { eventBus, SystemEvent } from '../core/events.js'

export class IdentityService implements IIdentityService {
  private readonly repo: ProfileRepository

  constructor() {
    this.repo = new ProfileRepository()
  }

  /**
   * Si el userId no existe en User, crea un User mínimo para satisfacer la FK
   * de ArtistProfile.userId (SQLite/Prisma).
   */
  private async ensureUserExists(userId: string, aliasHint: string): Promise<void> {
    const existing = await prisma.user.findUnique({ where: { id: userId } })
    if (existing) return

    const safeAlias = `u_${userId.slice(0, 12)}`
    await prisma.user.create({
      data: {
        id:       userId,
        email:    `${userId}@placeholder.son1kverse.local`,
        alias:    safeAlias,
        password: 'uninitialized',
      },
    })
    console.log(`[IdentityService] User auto-creado para FK: ${userId} (hint: ${aliasHint})`)
  }

  async createProfile(data: CreateProfileDTO): Promise<ArtistProfile> {
    await this.ensureUserExists(data.userId, data.alias)
    const profile = await this.repo.create(data)
    eventBus.emit(SystemEvent.PROFILE_CREATED, { profileId: profile.id, alias: profile.alias })
    console.log(`[IdentityService] Perfil creado: ${profile.alias} (${profile.id})`)
    return profile
  }

  async updateProfile(id: string, data: UpdateProfileDTO): Promise<ArtistProfile> {
    const profile = await this.repo.update(id, data)
    eventBus.emit(SystemEvent.PROFILE_UPDATED, { profileId: profile.id, timestamp: new Date() })
    return profile
  }

  async getProfile(id: string): Promise<ArtistProfile> {
    return this.repo.findById(id)
  }

  async getProfileByAlias(alias: string): Promise<ArtistProfile | null> {
    return this.repo.findByAlias(alias)
  }

  // El perfil evoluciona basado en feedback del artista.
  // Positivo (score > 0.7): refuerza las palabras recurrentes del artista.
  // Negativo (score < 0.3): retira del perfil lo que el artista rechazó.
  // Los tags sólo se incorporan a la estética con score >= 0.5 — un "1/10 con
  // tags" no puede reforzar justamente lo rechazado.
  async evolveFromFeedback(profileId: string, feedback: Feedback): Promise<void> {
    const profile = await this.repo.findById(profileId)
    const changes: string[] = []

    const noteWords = feedback.note
      ? feedback.note.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      : []
    const tagWords  = (feedback.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean)

    if (feedback.score > 0.7 && noteWords.length > 0) {
      // Resultado positivo: registrar palabras del feedback note
      const updated = [...new Set([...profile.recurringWords, ...noteWords])].slice(0, 50)
      await this.repo.update(profileId, { recurringWords: updated })
      changes.push('recurringWords')
    }

    if (feedback.score < 0.3) {
      // Resultado negativo: debilitar — retirar tags y palabras con las que el
      // artista marcó el resultado como malo.
      const reject = new Set([...tagWords, ...noteWords])

      if (reject.size > 0) {
        const keptWords = profile.recurringWords.filter(w => !reject.has(w.toLowerCase()))
        if (keptWords.length !== profile.recurringWords.length) {
          await this.repo.update(profileId, { recurringWords: keptWords })
          changes.push('recurringWords')
        }

        const keptAesthetics = profile.aesthetics.filter(a => !reject.has(a.toLowerCase()))
        if (keptAesthetics.length !== profile.aesthetics.length) {
          await this.repo.update(profileId, { aesthetics: keptAesthetics })
          changes.push('aesthetics')
        }
      }
    } else if (feedback.score >= 0.5 && tagWords.length > 0) {
      // Tags con feedback aceptable: refinan la estética
      const updated = [...new Set([...profile.aesthetics, ...tagWords])].slice(0, 30)
      await this.repo.update(profileId, { aesthetics: updated })
      changes.push('aesthetics')
    }

    if (changes.length > 0) {
      eventBus.emit(SystemEvent.PROFILE_EVOLVED, {
        profileId,
        changedFields: changes as (keyof ArtistProfile)[],
        timestamp: new Date(),
      })
    }
  }

  async deleteProfile(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
