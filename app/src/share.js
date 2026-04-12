/**
 * On iOS Safari, navigator.share() with files routes through the native share
 * sheet, which offers "Save Image" → Photos. Falls back to standard <a> download
 * on desktop or unsupported browsers.
 */
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      if (err.name === 'AbortError') return // user dismissed — do nothing
      // other error: fall through to regular download
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
