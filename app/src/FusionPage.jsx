import { useState, useEffect, useRef } from 'react'
import './FusionPage.css'

const API_BASE = 'https://api.normies.art'

const COLORWAYS = [
  { id: 'original',  label: 'Original',  on: '#48494b', off: '#e3e5e4' },
  { id: 'invert',    label: 'Invert',    on: '#e3e5e4', off: '#48494b' },
  { id: 'matrix',    label: 'Matrix',    on: '#00ff41', off: '#0d0d0d' },
  { id: 'sunset',    label: 'Sunset',    on: '#ff6b35', off: '#1a0a00' },
  { id: 'arctic',    label: 'Arctic',    on: '#a8d8ea', off: '#1c2b3a' },
  { id: 'gold',      label: 'Gold',      on: '#ffd700', off: '#1a1200' },
  { id: 'crimson',   label: 'Crimson',   on: '#dc143c', off: '#0f0000' },
  { id: 'vaporwave', label: 'Vaporwave', on: '#ff71ce', off: '#01cdfe' },
  { id: 'ghost',     label: 'Ghost',     on: '#ffffff', off: '#111111' },
]

const METHODS = ['XOR', 'OR', 'AND', '50/50', 'SPLIT', 'BLEND']

function fusePixels(a, b, method, blendValue) {
  const result = []
  for (let i = 0; i < 1600; i++) {
    const pa = (a[i] ?? '0') === '1' ? 1 : 0
    const pb = (b[i] ?? '0') === '1' ? 1 : 0
    let pOut
    switch (method) {
      case 'XOR':   pOut = pa ^ pb; break
      case 'OR':    pOut = pa | pb; break
      case 'AND':   pOut = pa & pb; break
      case '50/50': pOut = Math.random() < 0.5 ? pa : pb; break
      case 'SPLIT': pOut = i < 800 ? pa : pb; break
      case 'BLEND': pOut = Math.random() < blendValue / 100 ? pb : pa; break
      default:      pOut = pa
    }
    result.push(pOut ? '1' : '0')
  }
  return result.join('')
}

function renderToCanvas(canvas, pixels, colorway) {
  const ctx  = canvas.getContext('2d')
  const SIZE = canvas.width
  const GRID = 40
  const CELL = SIZE / GRID
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      ctx.fillStyle = pixels[y * GRID + x] === '1' ? colorway.on : colorway.off
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
    }
  }
}

function randomIds(count) {
  const ids = new Set()
  while (ids.size < count) ids.add(Math.floor(Math.random() * 10000))
  return [...ids]
}

export default function FusionPage() {
  const [collectionSize, setCollectionSize] = useState(null)
  const [candidateIds,   setCandidateIds]   = useState(() => randomIds(8))
  const [failedIds,      setFailedIds]      = useState(new Set())
  const [parentA,        setParentA]        = useState(null)
  const [parentB,        setParentB]        = useState(null)
  const [loadingPixels,  setLoadingPixels]  = useState({})
  const [method,         setMethod]         = useState(null)
  const [blendValue,     setBlendValue]     = useState(50)
  const [fusedPixels,    setFusedPixels]    = useState(null)
  const [colorway,       setColorway]       = useState('original')
  const [downloading,    setDownloading]    = useState(false)

  const canvasRef   = useRef(null)
  const pixAborts   = useRef({})

  // Fetch collection size once on mount
  useEffect(() => {
    fetch(`${API_BASE}/history/stats`)
      .then(r => r.json())
      .then(data => {
        const burned = parseInt(data.totalBurnedTokens ?? 0, 10)
        if (!isNaN(burned)) setCollectionSize(10000 - burned)
      })
      .catch(() => {})
  }, [])

  // Render canvas whenever fused pixels or colorway changes
  useEffect(() => {
    if (!fusedPixels || !canvasRef.current) return
    const cw = COLORWAYS.find(c => c.id === colorway)
    renderToCanvas(canvasRef.current, fusedPixels, cw)
  }, [fusedPixels, colorway])

  function shuffle() {
    // Cancel any in-flight pixel fetches
    Object.values(pixAborts.current).forEach(c => c.abort())
    pixAborts.current = {}
    setCandidateIds(randomIds(8))
    setFailedIds(new Set())
    setParentA(null)
    setParentB(null)
    setMethod(null)
    setFusedPixels(null)
  }

  async function selectCandidate(id) {
    // Toggle off if already selected
    if (parentA?.id === id) {
      setParentA(parentB)
      setParentB(null)
      setMethod(null)
      setFusedPixels(null)
      return
    }
    if (parentB?.id === id) {
      setParentB(null)
      setMethod(null)
      setFusedPixels(null)
      return
    }
    // Both already chosen — no-op until user deselects one
    if (parentA && parentB) return

    // Fetch pixels for this normie
    const controller = new AbortController()
    pixAborts.current[id] = controller
    setLoadingPixels(prev => ({ ...prev, [id]: true }))

    try {
      const res = await fetch(`${API_BASE}/normie/${id}/pixels`, { signal: controller.signal })
      if (!res.ok) { setFailedIds(prev => new Set([...prev, id])); return }
      const raw = (await res.text()).trim()
      if (raw.length < 1600) { setFailedIds(prev => new Set([...prev, id])); return }

      const candidate = { id, pixels: raw.slice(0, 1600) }
      // Re-check state in setter to avoid stale closure issues
      setParentA(prevA => {
        if (!prevA) return candidate
        setParentB(prevB => prevB ?? candidate)
        return prevA
      })
    } catch (err) {
      if (err.name !== 'AbortError') setFailedIds(prev => new Set([...prev, id]))
    } finally {
      setLoadingPixels(prev => { const n = { ...prev }; delete n[id]; return n })
      delete pixAborts.current[id]
    }
  }

  function handleMethodSelect(m) {
    setMethod(m)
    setFusedPixels(fusePixels(parentA.pixels, parentB.pixels, m, blendValue))
  }

  function handleBlendChange(val) {
    setBlendValue(val)
    if (method === 'BLEND') {
      setFusedPixels(fusePixels(parentA.pixels, parentB.pixels, 'BLEND', val))
    }
  }

  async function downloadPng() {
    if (!fusedPixels) return
    setDownloading(true)
    try {
      const SIZE = 1200
      const GRID = 40
      const CELL = SIZE / GRID
      const cw   = COLORWAYS.find(c => c.id === colorway)
      const off  = document.createElement('canvas')
      off.width  = SIZE
      off.height = SIZE
      const ctx  = off.getContext('2d')
      for (let y = 0; y < GRID; y++)
        for (let x = 0; x < GRID; x++) {
          ctx.fillStyle = fusedPixels[y * GRID + x] === '1' ? cw.on : cw.off
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
        }
      const methodSlug = method.replace(/\//g, '-').toLowerCase()
      await new Promise(resolve => {
        off.toBlob(blob => {
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `normie-fusion-${parentA.id}-${parentB.id}-${methodSlug}.png`
          a.click()
          URL.revokeObjectURL(a.href)
          resolve()
        }, 'image/png')
      })
    } finally {
      setDownloading(false)
    }
  }

  function startOver() {
    Object.values(pixAborts.current).forEach(c => c.abort())
    pixAborts.current = {}
    setParentA(null)
    setParentB(null)
    setMethod(null)
    setFusedPixels(null)
    setColorway('original')
    shuffle()
  }

  const activeCw    = COLORWAYS.find(c => c.id === colorway)
  const bothChosen  = parentA && parentB

  return (
    <div className="fusion-page">
      <header className="header">
        <h1 className="title">Normie Fusion</h1>
        <p className="subtitle">
          {collectionSize != null
            ? `${collectionSize.toLocaleString()} normies in collection`
            : 'Select two normies to fuse'}
        </p>
      </header>

      {/* Candidate grid */}
      <div className="fusion-section">
        <div className="fusion-row-header">
          <span className="section-label">
            {!parentA
              ? 'Select parent A'
              : !parentB
              ? 'Select parent B'
              : 'Two selected — choose a method below'}
          </span>
          <button className="nav-link" onClick={shuffle}>Shuffle</button>
        </div>

        <div className="candidates-grid">
          {candidateIds.map(id => {
            const isA      = parentA?.id === id
            const isB      = parentB?.id === id
            const failed   = failedIds.has(id)
            const fetching = !!loadingPixels[id]
            return (
              <button
                key={id}
                className={[
                  'candidate-card',
                  isA      ? 'parent-a'       : '',
                  isB      ? 'parent-b'       : '',
                  failed   ? 'card-failed'    : '',
                  fetching ? 'card-fetching'  : '',
                ].filter(Boolean).join(' ')}
                onClick={() => !failed && selectCandidate(id)}
                disabled={fetching || (!isA && !isB && bothChosen)}
              >
                <img
                  src={`${API_BASE}/normie/${id}/image.svg`}
                  alt={`Normie #${id}`}
                  className="candidate-img"
                  onError={() => setFailedIds(prev => new Set([...prev, id]))}
                />
                <span className="candidate-id">#{id}</span>
                {isA && <span className="candidate-badge badge-a">A</span>}
                {isB && <span className="candidate-badge badge-b">B</span>}
                {fetching && (
                  <div className="candidate-spinner">
                    <div className="spinner" />
                  </div>
                )}
                {failed && <span className="candidate-burned">burned</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Fusion method — appears once both parents are chosen */}
      {bothChosen && (
        <div className="fusion-section">
          <span className="section-label">
            Fusion method — #{parentA.id} × #{parentB.id}
          </span>
          <div className="effects-row">
            {METHODS.map(m => (
              <button
                key={m}
                className={`effect-btn${method === m ? ' active' : ''}`}
                onClick={() => handleMethodSelect(m)}
              >
                {m}
              </button>
            ))}
          </div>
          {method === 'BLEND' && (
            <div className="blend-control">
              <span className="blend-label">A</span>
              <input
                type="range" min="0" max="100" value={blendValue}
                onChange={e => handleBlendChange(Number(e.target.value))}
                className="blend-slider"
              />
              <span className="blend-label">B</span>
              <span className="blend-pct">{blendValue}%</span>
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {fusedPixels && (
        <div className="fusion-section">
          <span className="section-label">Result [{method}]</span>
          <canvas
            ref={canvasRef}
            width={400}
            height={400}
            className="fusion-canvas"
          />
          <div className="effects-panel">
            <span className="effects-label">Colorway</span>
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
            <button className="download-btn" onClick={downloadPng} disabled={downloading}>
              {downloading ? 'Downloading…' : 'Download PNG'}
            </button>
          </div>
          <button className="download-btn fusion-start-over" onClick={startOver}>
            Start Over
          </button>
        </div>
      )}
    </div>
  )
}
