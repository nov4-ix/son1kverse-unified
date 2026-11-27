// ─── SON1KVERSE — Envío de correo transaccional ───────────────────────────────
// Proveedor por entorno. En tests y desarrollo local se usa "console": el
// mensaje se registra y no se envía nada. En producción se exige Resend.

import { config } from '../config/index.js'
import { logger } from '../lib/logger.js'

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const EMAIL_TIMEOUT_MS = 10_000

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (config.EMAIL_PROVIDER === 'console') {
    logger.info(
      { to: message.to, subject: message.subject, preview: message.text.slice(0, 240) },
      '[email] mensaje registrado en consola (EMAIL_PROVIDER=console)',
    )
    return
  }

  if (config.EMAIL_PROVIDER !== 'resend') {
    throw new Error(`EMAIL_PROVIDER no soportado: ${String(config.EMAIL_PROVIDER)}`)
  }
  if ((config.EMAIL_API_KEY ?? '') === '') {
    throw new Error('EMAIL_API_KEY no está configurada')
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.EMAIL_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: config.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html === undefined ? {} : { html: message.html }),
    }),
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend respondió ${response.status}: ${detail.slice(0, 300)}`)
  }
}
