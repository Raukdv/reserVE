/**
 * Redimensiona y convierte a WebP en el navegador antes de subir.
 *
 * Existe porque el almacenamiento del plan gratuito de Supabase es 1 GB y una
 * foto de móvil sin tratar pesa entre 2 y 5 MB. Comprimida ronda los 150 KB, así
 * que el mismo gigabyte pasa de doscientas imágenes a varios miles.
 * Ver docs/COSTO-CERO.md, regla 3.6.
 *
 * Ante cualquier fallo —formato raro, canvas bloqueado por privacidad— devuelve
 * el archivo original y deja que el servidor decida. Es preferible un rechazo
 * claro por tamaño a perder el archivo en silencio.
 */
export async function compressImage(
  file: File,
  { maxEdge, quality }: { maxEdge: number; quality: number },
): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    )
    if (!blob) return file

    // Una imagen ya optimizada puede crecer al recodificarla; en ese caso se
    // conserva la original.
    if (blob.size >= file.size) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'imagen'
    return new File([blob], `${base}.webp`, { type: 'image/webp' })
  } catch {
    return file
  }
}

export const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`
