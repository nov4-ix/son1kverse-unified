import { useAuthorizedAudio } from '../lib/useAuthorizedAudio'

export function AuthedAudio({ src, className }: { src: string | null; className?: string }) {
  const { blobUrl, error } = useAuthorizedAudio(src)

  if (src === null) return null
  if (error !== null) {
    return <p className="font-mono text-[10px] text-red-400">{error}</p>
  }
  if (blobUrl === null) {
    return <p className="font-mono text-[10px] text-zinc-500">Cargando audio...</p>
  }
  return <audio className={className} controls src={blobUrl} />
}
