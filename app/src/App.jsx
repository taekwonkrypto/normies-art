import { useState, useEffect, useRef } from 'react'
import GIF from 'gif.js'
import FusionPage from './FusionPage'
import AnimatePage from './AnimatePage'
import DataPage from './DataPage'
import './App.css'

const API_BASE = 'https://api.normies.art'

const BASE_ON  = '48494b'
const BASE_OFF = 'e3e5e4'

const COLORWAYS = [
  { id: 'original',  label: 'Original',  on: `#${BASE_ON}`,  off: `#${BASE_OFF}` },
  { id: 'invert',    label: 'Invert',    on: `#${BASE_OFF}`, off: `#${BASE_ON}`  },
  { id: 'matrix',    label: 'Matrix',    on: '#00ff41',      off: '#0d0d0d'      },
  { id: 'sunset',    label: 'Sunset',    on: '#ff6b35',      off: '#1a0a00'      },
  { id: 'arctic',    label: 'Arctic',    on: '#a8d8ea',      off: '#1c2b3a'      },
  { id: 'gold',      label: 'Gold',      on: '#ffd700',      off: '#1a1200'      },
  { id: 'crimson',   label: 'Crimson',   on: '#dc143c',      off: '#0f0000'      },
  { id: 'vaporwave', label: 'Vaporwave', on: '#ff71ce',      off: '#01cdfe'      },
  { id: 'ghost',     label: 'Ghost',     on: '#ffffff',      off: '#111111'      },
]

function applyColorway(svgText, cw) {
  const regex = new RegExp(`#(${BASE_ON}|${BASE_OFF})`, 'gi')
  return svgText.replace(regex, (match, hex) => {
    if (hex.toLowerCase() === BASE_ON)  return cw.on
    if (hex.toLowerCase() === BASE_OFF) return cw.off
    return match
  })
}

function checkCustomized(traits) {
  if (Array.isArray(traits)) {
    return traits.some(
      t => t.trait_type?.toLowerCase() === 'customized' &&
           t.value?.toLowerCase()      === 'yes'
    )
  }
  const val = traits['Customized'] ?? traits['customized']
  return typeof val === 'string' && val.toLowerCase() === 'yes'
}

function formatDate(ts) {
  if (!ts) return ''
  // Timestamps from the API are Unix seconds (10 digits) as strings
  const ms = String(ts).length <= 10 ? parseInt(ts, 10) * 1000 : parseInt(ts, 10)
  return new Date(ms)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .replace(',', '')
}

function VersionThumb({ v, idx, svgText, cw, active, onClick }) {
  const src = svgText
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(applyColorway(svgText, cw))}`
    : null
  const changes = v.changeCount ?? v.pixel_changes ?? v.pixels_changed ?? v.changes ?? 0
  const ts = v.timestamp ?? v.created_at ?? v.date ?? null

  return (
    <button className={`version-thumb${active ? ' active' : ''}`} onClick={onClick}>
      {src
        ? <img src={src} alt={`V${idx}`} className="thumb-img" />
        : <div className="thumb-placeholder" />
      }
      <span className="thumb-label">V{idx}</span>
      {ts && <span className="thumb-date">{formatDate(ts)}</span>}
      <span className="thumb-changes">{changes >= 0 ? `+${changes}` : changes}px</span>
    </button>
  )
}

function App() {
  const [currentPage, setCurrentPage] = useState('explore')
  const [inputId, setInputId]         = useState('')
  const [normie, setNormie]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [colorway, setColorway]       = useState('original')
  const [svgText, setSvgText]         = useState(null)
  const [svgBlobUrl, setSvgBlobUrl]   = useState(null)
  const [downloading, setDownloading] = useState(false)

  const [versions, setVersions]               = useState(null)
  const [activeVersionIdx, setActiveVersionIdx] = useState(null)
  const [versionSvgTexts, setVersionSvgTexts] = useState({})
  const [playing, setPlaying]                 = useState(false)
  const [frameDelay, setFrameDelay]           = useState(1500)
  const [delayDraft, setDelayDraft]           = useState('1500')
  const [downloadingGif, setDownloadingGif]   = useState(false)
  const playIntervalRef                       = useRef(null)

  // Fetch current normie SVG
  useEffect(() => {
    if (!normie) { setSvgText(null); return }
    const controller = new AbortController()
    fetch(`${API_BASE}/normie/${normie.id}/image.svg`, { signal: controller.signal })
      .then(r => r.text())
      .then(text => setSvgText(text))
      .catch(err => { if (err.name !== 'AbortError') setSvgText(null) })
    return () => controller.abort()
  }, [normie?.id])

  // Compute blob URL from svgText + colorway
  useEffect(() => {
    if (!svgText) { setSvgBlobUrl(null); return }
    const cw = COLORWAYS.find(c => c.id === colorway)
    const blob = new Blob([applyColorway(svgText, cw)], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    setSvgBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [svgText, colorway])

  // Fetch version list if normie is customized
  useEffect(() => {
    if (!normie) { setVersions(null); return }
    const customized = checkCustomized(normie.traits)
    console.log(`[normie #${normie.id}] checkCustomized:`, customized, '| traits:', normie.traits)
    if (!customized) { setVersions(null); return }
    const controller = new AbortController()
    const url = `${API_BASE}/history/normie/${normie.id}/versions`
    console.log(`[normie #${normie.id}] fetching versions:`, url)
    fetch(url, { signal: controller.signal })
      .then(r => { console.log(`[normie #${normie.id}] /versions status:`, r.status); return r.json() })
      .then(data => {
        console.log(`[normie #${normie.id}] /versions data:`, data)
        setVersions(data)
        setActiveVersionIdx(data.length - 1)
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error(`[normie #${normie.id}] /versions error:`, err)
          setVersions([])
        }
      })
    return () => controller.abort()
  }, [normie?.id])

  // Fetch SVG for each version
  useEffect(() => {
    if (!versions || !normie) return
    const controllers = []
    versions.forEach(v => {
      const controller = new AbortController()
      controllers.push(controller)
      fetch(
        `${API_BASE}/history/normie/${normie.id}/version/${v.version}/image.svg`,
        { signal: controller.signal }
      )
        .then(r => r.text())
        .then(text => setVersionSvgTexts(prev => ({ ...prev, [v.version]: text })))
        .catch(() => {})
    })
    return () => controllers.forEach(c => c.abort())
  }, [versions, normie?.id])

  // Update main image when active version changes
  useEffect(() => {
    if (!versions || activeVersionIdx === null) return
    const v = versions[activeVersionIdx]
    if (!v) return
    const text = versionSvgTexts[v.version]
    if (text) setSvgText(text)
  }, [activeVersionIdx, versionSvgTexts, versions])

  // Playback interval
  useEffect(() => {
    if (!playing || !versions) return
    playIntervalRef.current = setInterval(() => {
      setActiveVersionIdx(prev => (prev + 1) % versions.length)
    }, frameDelay)
    return () => clearInterval(playIntervalRef.current)
  }, [playing, versions, frameDelay])

  async function downloadGif() {
    if (!versions || versions.length < 2) return
    setDownloadingGif(true)
    try {
      const cw = COLORWAYS.find(c => c.id === colorway)
      const SIZE = 600
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width: SIZE,
        height: SIZE,
        workerScript: '/gif.worker.js',
        repeat: 0,
      })
      for (const v of versions) {
        const text = versionSvgTexts[v.version]
        if (!text) continue
        const modified = applyColorway(text, cw)
        const blob = new Blob([modified], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        await new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = SIZE
            canvas.height = SIZE
            canvas.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE)
            URL.revokeObjectURL(url)
            gif.addFrame(canvas, { delay: frameDelay, copy: true })
            resolve()
          }
          img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
          img.src = url
        })
      }
      await new Promise((resolve, reject) => {
        gif.on('finished', pngBlob => {
          const a = document.createElement('a')
          a.href = URL.createObjectURL(pngBlob)
          a.download = `normie-${normie.id}-${colorway}.gif`
          a.click()
          URL.revokeObjectURL(a.href)
          resolve()
        })
        gif.on('abort', () => reject(new Error('aborted')))
        gif.render()
      })
    } catch (err) {
      console.error('GIF export failed:', err)
    } finally {
      setDownloadingGif(false)
    }
  }

  async function downloadPng() {
    if (!svgText || !normie) return
    setDownloading(true)
    try {
      const cw = COLORWAYS.find(c => c.id === colorway)
      const modified = applyColorway(svgText, cw)
      const blob = new Blob([modified], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width  = 1200
          canvas.height = 1200
          canvas.getContext('2d').drawImage(img, 0, 0, 1200, 1200)
          URL.revokeObjectURL(url)
          canvas.toBlob(pngBlob => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(pngBlob)
            a.download = `normie-${normie.id}-${colorway}.png`
            a.click()
            URL.revokeObjectURL(a.href)
            resolve()
          }, 'image/png')
        }
        img.onerror = reject
        img.src = url
      })
    } finally {
      setDownloading(false)
    }
  }

  async function loadNormie() {
    const id = parseInt(inputId, 10)
    if (isNaN(id) || id < 0 || id > 9999) {
      setError('Please enter a valid token ID between 0 and 9999.')
      setNormie(null)
      return
    }
    setLoading(true)
    setError(null)
    setNormie(null)
    setColorway('original')
    setVersions(null)
    setActiveVersionIdx(null)
    setVersionSvgTexts({})
    setPlaying(false)

    try {
      const res = await fetch(`${API_BASE}/normie/${id}/metadata`)
      if (!res.ok) throw new Error(`Token #${id} not found (${res.status})`)
      const data = await res.json()
      console.log(`[normie #${id}] /metadata raw:`, data)
      const traits = data.attributes ?? data
      console.log(`[normie #${id}] traits (${traits.length}):`, traits)

      setNormie({ id, traits })
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') loadNormie()
  }

  const activeCw = COLORWAYS.find(c => c.id === colorway)

  return (
    <>
      <nav className="topbar">
        <span className="topbar-brand">Normies.Art Tools</span>
        <div className="topbar-nav">
          <button
            className={`nav-link${currentPage === 'explore' ? ' active' : ''}`}
            onClick={() => setCurrentPage('explore')}
          >
            Explore
          </button>
          <button
            className={`nav-link${currentPage === 'animate' ? ' active' : ''}`}
            onClick={() => setCurrentPage('animate')}
          >
            Animate
          </button>
          <button
            className={`nav-link${currentPage === 'data' ? ' active' : ''}`}
            onClick={() => setCurrentPage('data')}
          >
            Data
          </button>
          <button
            className={`nav-link${currentPage === 'create' ? ' active' : ''}`}
            onClick={() => setCurrentPage('create')}
          >
            Create
          </button>
        </div>
      </nav>

      {currentPage === 'create' ? <FusionPage /> : currentPage === 'animate' ? <AnimatePage /> : currentPage === 'data' ? <DataPage /> : (
      <div className="app">
      <header className="header">
        <h1 className="title">Normies Art Tools</h1>
        <p className="subtitle">Enter a Normie token ID to get started</p>
      </header>

      <div className="input-row">
        <input
          className="token-input"
          type="number"
          min="0"
          max="9999"
          placeholder="Token ID (0–9999)"
          value={inputId}
          onChange={(e) => setInputId(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="load-btn" onClick={loadNormie} disabled={loading}>
          {loading ? 'Loading…' : 'Load Normie'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <span>Fetching Normie…</span>
        </div>
      )}

      {normie && !loading && (
        <div className="normie-card">
          <h2 className="normie-title">Normie #{normie.id}</h2>
          {svgBlobUrl && (
            <img
              className="normie-image"
              src={svgBlobUrl}
              alt={`Normie #${normie.id}`}
            />
          )}

          <div className="effects-panel">
            <span className="effects-label">Effects</span>
            <div className="effects-row">
              {COLORWAYS.map(cw => (
                <button
                  key={cw.id}
                  className={`effect-btn${colorway === cw.id ? ' active' : ''}`}
                  onClick={() => setColorway(cw.id)}
                >
                  {cw.label}
                </button>
              ))}
            </div>
            <button
              className="download-btn"
              onClick={downloadPng}
              disabled={downloading || !svgBlobUrl}
            >
              {downloading ? 'Downloading…' : 'Download PNG'}
            </button>
          </div>

          {versions && versions.length > 0 && (
            <div className="version-history">
              <div className="version-header">
                <span className="version-label">Version History</span>
                {versions.length > 1 && (
                  <div className="version-controls">
                    <div className="delay-control">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="delay-input"
                        value={delayDraft}
                        onChange={e => setDelayDraft(e.target.value)}
                        onBlur={() => {
                          const n = parseInt(delayDraft, 10)
                          const clamped = isNaN(n) ? frameDelay : Math.max(100, Math.min(9999, n))
                          setFrameDelay(clamped)
                          setDelayDraft(String(clamped))
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.target.blur()
                        }}
                      />
                      <span className="delay-unit">ms</span>
                    </div>
                    <button className="play-btn" onClick={() => setPlaying(p => !p)}>
                      {playing ? 'Stop' : 'Play'}
                    </button>
                    <button
                      className="play-btn"
                      onClick={downloadGif}
                      disabled={downloadingGif}
                    >
                      {downloadingGif ? 'Encoding…' : 'GIF'}
                    </button>
                  </div>
                )}
              </div>
              <div className="filmstrip">
                {versions.map((v, i) => (
                  <VersionThumb
                    key={v.version}
                    v={v}
                    idx={i}
                    svgText={versionSvgTexts[v.version] ?? null}
                    cw={activeCw}
                    active={activeVersionIdx === i}
                    onClick={() => { setPlaying(false); setActiveVersionIdx(i) }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="traits">
            {Array.isArray(normie.traits)
              ? normie.traits.map((trait, i) => (
                  <div className="trait" key={i}>
                    <span className="trait-type">{trait.trait_type}</span>
                    <span className="trait-value">{trait.value}</span>
                  </div>
                ))
              : Object.entries(normie.traits).map(([key, val]) => (
                  <div className="trait" key={key}>
                    <span className="trait-type">{key}</span>
                    <span className="trait-value">{String(val)}</span>
                  </div>
                ))}
          </div>
        </div>
      )}
    </div>
      )}
    </>
  )
}

export default App
