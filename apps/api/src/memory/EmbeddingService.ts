// ─── SON1KVERSE — Embedding Service ──────────────────────────────────────────
// Vectorizador determinista de dimensión fija (128) basado en Feature Hashing (Hashing Trick)
// y subpalabras n-gram. Permite similitud semántica y léxica precisa sin dependencias externas.

import type { IEmbeddingService } from '../core/interfaces.js'

export class EmbeddingService implements IEmbeddingService {
  private static readonly DIMENSION = 128

  // Cosine similarity entre dos vectores normalizados
  similarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      const valA = a[i] ?? 0
      const valB = b[i] ?? 0
      dot   += valA * valB
      normA += valA ** 2
      normB += valB ** 2
    }

    if (normA === 0 || normB === 0) return 0
    const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB))
    return Math.max(0, Math.min(1, sim))
  }

  // Genera un vector normalizado de dimensión fija para cualquier texto
  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(EmbeddingService.DIMENSION).fill(0)
    const tokens = this.tokenize(text)

    if (tokens.length === 0) {
      return vector
    }

    // 1. Ponderar palabras completas
    for (const token of tokens) {
      const bucket = this.fnv1a(token) % EmbeddingService.DIMENSION
      vector[bucket] = (vector[bucket] ?? 0) + 2.0
    }

    // 2. Ponderar n-grams de 3 caracteres para capturar similitudes morfológicas ("melancolía" / "melancólico")
    for (const token of tokens) {
      if (token.length >= 3) {
        for (let i = 0; i <= token.length - 3; i++) {
          const gram = token.slice(i, i + 3)
          const bucket = this.fnv1a(`g:${gram}`) % EmbeddingService.DIMENSION
          vector[bucket] = (vector[bucket] ?? 0) + 0.5
        }
      }
    }

    // 3. Normalizar vector a norma unitaria (L2)
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v ** 2, 0))
    if (norm === 0) return vector
    return vector.map(v => Number((v / norm).toFixed(6)))
  }

  findMostSimilar(
    query: number[],
    candidates: Array<{ id: string; embedding: number[] }>,
    limit = 10,
  ): Array<{ id: string; score: number }> {
    return candidates
      .map(c => ({ id: c.id, score: this.similarity(query, c.embedding) }))
      .filter(c => c.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // normalizar acentos para que coincidan
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2)
  }

  // Hash determinista FNV-1a de 32-bit sin signo
  private fnv1a(str: string): number {
    let hash = 2166136261
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return Math.abs(hash >>> 0)
  }
}
