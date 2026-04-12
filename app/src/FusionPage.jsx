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

const TYPES   = ['HUMAN', 'CAT', 'ALIEN', 'AGENT']
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

export default function FusionPage() {
  const [selectedType,      setSelectedType]      = useState(null)
  const [candidates,        setCandidates]        = useState([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [loadingProgress,   setLoadingProgress]   = useState(0)
  const [parentA,           setParentA]           = useState(null)
  const [parentB,           setParentB]           = useState(null)
  const [method,            setMethod]            = useState(null)
  const [blendValue,        setBlendValue]        = useState(50)
  const [fusedPixels,       setFusedPixels]       = useState(null)
  const [colorway,          setColorway]          = useState('original')
  const [downloading,       setDownloading]       = useState(false)

  const canvasRef = useRef(null)
  const abortRef  = useRef(null)

  // Check one ID against the target type; returns { id, pixels } or null
  async function checkOne(id, type, signal) {
    try {
      const res = await fetch(`${API_BASE}/normie/${id}/metadata`, { signal })
      if (!res.ok) return null
      const data = await res.json()
      if (data.error) return null

      const attrs = data.attributes ?? data
      let normieType = null
      if (Array.isArray(attrs)) {
        normieType = attrs.find(t => t.trait_type?.toLowerCase() === 'type')?.value
      } else {
        normieType = attrs['Type'] ?? attrs['type']
      }
      if (normieType?.toUpperCase() !== type) return null

      const pixRes = await fetch(`${API_BASE}/normie/${id}/pixels`, { signal })
      if (!pixRes.ok) return null
      const raw = (await pixRes.text()).trim()
      if (raw.length < 1600) return null

      return { id, pixels: raw.slice(0, 1600) }
    } catch (err) {
      if (err.name === 'AbortError') throw err
      return null
    }
  }

  async function fetchCandidates(type) {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoadingCandidates(true)
    setCandidates([])
    setLoadingProgress(0)

    const found = []
    const tried = new Set()

    function nextId() {
      let id
      do { id = Math.floor(Math.random() * 10000) } while (tried.has(id))
      tried.add(id)
      return id
    }

    try {
      // Check 4 IDs concurrently, keep refilling until we have 4 matches
      while (found.length < 4 && !controller.signal.aborted) {
        const batch = Array.from({ length: 4 }, nextId)
        const results = await Promise.allSettled(
          batch.map(id => checkOne(id, type, controller.signal))
        )
        for (const r of results) {
          if (controller.signal.aborted) break
          if (r.status === 'fulfilled' && r.value) {
            found.push(r.value)
            setLoadingProgress(found.length)
            setCandidates([...found])
            if (found.length >= 4) break
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('fetchCandidates:', err)
    } finally {
      if (!controller.signal.aborted) setLoadingCandidates(false)
    }
  }

  function handleTypeSelect(type) {
    setSelectedType(type)
    setParentA(null)
    setParentB(null)
    setMethod(null)
    setFusedPixels(null)
    fetchCandidates(type)
  }

  function handleCandidateClick(c) {
    if (parentA?.id === c.id) {
      setParentA(parentB)
      setParentB(null)
      setMethod(null)
      setFusedPixels(null)
    } else if (parentB?.id === c.id) {
      setParentB(null)
      setMethod(null)
      setFusedPixels(null)
    } else if (!parentA) {
      setParentA(c)
    } else if (!parentB) {
      setParentB(c)
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

  // Redraw canvas whenever fused pixels or colorway change
  useEffect(() => {
    if (!fusedPixels || !canvasRef.current) return
    const cw = COLORWAYS.find(c => c.id === colorway)
    renderToCanvas(canvasRef.current, fusedPixels, cw)
  }, [fusedPixels, colorway])

  async function downloadPng() {
    if (!fusedPixels) return
    setDownloading(true)
    try {
      const SIZE = 1200
      const GRID = 40
      const CELL = SIZE / GRID
      const cw   = COLORWAYS.find(c => c.id === colorway)
      const offscreen = document.createElement('canvas')
      offscreen.width  = SIZE
      offscreen.height = SIZE
      const ctx = offscreen.getContext('2d')
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          ctx.fillStyle = fusedPixels[y * GRID + x] === '1' ? cw.on : cw.off
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
        }
      }
      const methodSlug = method.replace(/\//g, '-').toLowerCase()
      await new Promise(resolve => {
        offscreen.toBlob(blob => {
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
    if (abortRef.current) abortRef.current.abort()
    setSelectedType(null)
    setCandidates([])
    setLoadingCandidates(false)
    setLoadingProgress(0)
    setParentA(null)
    setParentB(null)
    setMethod(null)
    setFusedPixels(null)
    setColorway('original')
  }

  const activeCw = COLORWAYS.find(c => c.id === colorway)

  return (
    <div className="fusion-page">
      <header className="header">
        <h1 className="title">Normie Fusion</h1>
        <p className="subtitle">Select a type to begin</p>
      </header>

      {/* Step 1: Type */}
      <div className="fusion-section">
        <span className="section-label">Step 1 — Type</span>
        <div className="fusion-type-row">
          {TYPES.map(type => (
            <button
              key={type}
              className={`effect-btn${selectedType === type ? ' active' : ''}`}
              onClick={() => handleTypeSelect(type)}
              disabled={loadingCandidates}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Candidates */}
      {selectedType && (
        <div className="fusion-section">
          <span className="section-label">
            Step 2 — Select Two Parents
            {loadingCandidates && ` (${loadingProgress}/4)`}
          </span>

          <div className="candidates-grid">
            {candidates.map(c => (
              <button
                key={c.id}
                className={[
                  'candidate-card',
                  parentA?.id === c.id ? 'parent-a' : '',
                  parentB?.id === c.id ? 'parent-b' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleCandidateClick(c)}
              >
                <img
                  src={`${API_BASE}/normie/${c.id}/image.svg`}
                  alt={`Normie #${c.id}`}
                  className="candidate-img"
                />
                <span className="candidate-id">#{c.id}</span>
                {parentA?.id === c.id && <span className="candidate-badge">A</span>}
                {parentB?.id === c.id && <span className="candidate-badge">B</span>}
              </button>
            ))}

            {loadingCandidates && Array.from({ length: 4 - candidates.length }).map((_, i) => (
              <div key={`ph-${i}`} className="candidate-card candidate-placeholder-card">
                <div className="candidate-placeholder">
                  <div className="spinner" />
                </div>
                <span className="candidate-id">…</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Method */}
      {parentA && parentB && (
        <div className="fusion-section">
          <span className="section-label">Step 3 — Fusion Method</span>
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
                type="range"
                min="0"
                max="100"
                value={blendValue}
                onChange={e => handleBlendChange(Number(e.target.value))}
                className="blend-slider"
              />
              <span className="blend-label">B</span>
              <span className="blend-pct">{blendValue}%</span>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Result */}
      {fusedPixels && (
        <div className="fusion-section">
          <span className="section-label">
            Result — #{parentA.id} × #{parentB.id} [{method}]
          </span>
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
            <button
              className="download-btn"
              onClick={downloadPng}
              disabled={downloading}
            >
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
