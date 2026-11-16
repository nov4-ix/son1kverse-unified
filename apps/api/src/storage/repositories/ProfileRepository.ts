// ─── SON1KVERSE — Profile Repository ─────────────────────────────────────────

import { prisma } from '../client.js'
import type { ArtistProfile, BpmRange, BrandingConfig, Emotion, MusicReference } from '../../core/types.js'
import type { CreateProfileDTO, UpdateProfileDTO } from '../../core/contracts.js'
import { ProfileNotFoundError, ProfileAlreadyExistsError } from '../../core/errors.js'

// SQLite guarda JSON como String. Estos helpers serializan/deserializan.
function serialize(value: unknown): string {
  return JSON.stringify(value)
}

function deserializeProfile(raw: {
  id: string
  userId: string
  alias: string
  genres: string
  bpmRange: string
  aesthetics: string
  references: string
  recurringWords: string
  emotions: string
  narrative: string
  vocalStyle: string | null
  branding: string | null
  createdAt: Date
  updatedAt: Date
}): ArtistProfile {
  return {
    id:             raw.id,
    userId:         raw.userId,
    alias:          raw.alias,
    genres:         JSON.parse(raw.genres) as string[],
    bpmRange:       JSON.parse(raw.bpmRange) as BpmRange,
    aesthetics:     JSON.parse(raw.aesthetics) as string[],
    references:     JSON.parse(raw.references) as MusicReference[],
    recurringWords: JSON.parse(raw.recurringWords) as string[],
    emotions:       JSON.parse(raw.emotions) as Emotion[],
    narrative:      raw.narrative,
    vocalStyle:     raw.vocalStyle ?? undefined,
    branding:       raw.branding ? (JSON.parse(raw.branding) as BrandingConfig) : undefined,
    createdAt:      raw.createdAt,
    updatedAt:      raw.updatedAt,
  }
}

export class ProfileRepository {
  async create(data: CreateProfileDTO): Promise<ArtistProfile> {
    const existing = await prisma.artistProfile.findUnique({ where: { alias: data.alias } })
    if (existing) throw new ProfileAlreadyExistsError(data.alias)

    const raw = await prisma.artistProfile.create({
      data: {
        userId:         data.userId,
        alias:          data.alias,
        genres:         serialize(data.genres),
        bpmRange:       serialize(data.bpmRange),
        aesthetics:     serialize(data.aesthetics),
        references:     serialize(data.references),
        recurringWords: serialize(data.recurringWords),
        emotions:       serialize(data.emotions),
        narrative:      data.narrative,
        vocalStyle:     data.vocalStyle ?? null,
        branding:       data.branding ? serialize(data.branding) : null,
      },
    })
    return deserializeProfile(raw)
  }

  async findById(id: string): Promise<ArtistProfile> {
    const raw = await prisma.artistProfile.findUnique({ where: { id } })
    if (!raw) throw new ProfileNotFoundError(id)
    return deserializeProfile(raw)
  }

  async findByAlias(alias: string): Promise<ArtistProfile | null> {
    const raw = await prisma.artistProfile.findUnique({ where: { alias } })
    return raw ? deserializeProfile(raw) : null
  }

  async findByUserId(userId: string): Promise<ArtistProfile | null> {
    const raw = await prisma.artistProfile.findUnique({ where: { userId } })
    return raw ? deserializeProfile(raw) : null
  }

  async update(id: string, data: UpdateProfileDTO): Promise<ArtistProfile> {
    const exists = await prisma.artistProfile.findUnique({ where: { id } })
    if (!exists) throw new ProfileNotFoundError(id)

    const raw = await prisma.artistProfile.update({
      where: { id },
      data: {
        ...(data.genres        && { genres:         serialize(data.genres) }),
        ...(data.bpmRange      && { bpmRange:        serialize(data.bpmRange) }),
        ...(data.aesthetics    && { aesthetics:      serialize(data.aesthetics) }),
        ...(data.references    && { references:      serialize(data.references) }),
        ...(data.recurringWords && { recurringWords: serialize(data.recurringWords) }),
        ...(data.emotions      && { emotions:        serialize(data.emotions) }),
        ...(data.narrative     && { narrative:       data.narrative }),
        ...(data.vocalStyle    && { vocalStyle:      data.vocalStyle }),
        ...(data.branding      && { branding:        serialize(data.branding) }),
      },
    })
    return deserializeProfile(raw)
  }

  async delete(id: string): Promise<void> {
    await prisma.artistProfile.delete({ where: { id } })
  }
}
