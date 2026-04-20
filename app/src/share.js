const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/**
 * On mobile, uses the native share sheet (iOS "Save to Photos", Android save).
 * On desktop, triggers a straight-to-Downloads file save.
 */
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type })
  if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      if (err.name === 'AbortError') return
      // other error: fall through to regular download
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
