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

function parseId(val) {
  const n = parseInt(val, 10)
  return !isNaN(n) && n >= 0 && n <= 9999 ? n : null
}

export default function FusionPage() {
  const [mode,           setMode]          = useState('random') // 'random' | 'ids'
  const [collectionSize, setCollectionSize] = useState(null)

  // Random mode
  const [candidateIds,  setCandidateIds]  = useState(() => randomIds(8))
  const [failedIds,     setFailedIds]     = useState(new Set())
  const [loadingPixels, setLoadingPixels] = useState({})

  // IDs mode
  const [inputA, setInputA] = useState('')
  const [inputB, setInputB] = useState('')
  const [computing, setComputing] = useState(false)
  const [idError,   setIdError]   = useState(null)

  // Shared
  const [parentA,     setParentA]     = useState(null)
  const [parentB,     setParentB]     = useState(null)
  const [method,      setMethod]      = useState(null)
  const [blendValue,  setBlendValue]  = useState(50)
  const [fusedPixels, setFusedPixels] = useState(null)
  const [colorway,    setColorway]    = useState('original')
  const [downloading, setDownloading] = useState(false)

  const canvasRef = useRef(null)
  const pixAborts = useRef({})

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

  function resetFusion() {
    setParentA(null)
    setParentB(null)
    setMethod(null)
    setFusedPixels(null)
    setIdError(null)
  }

  function switchMode(m) {
    Object.values(pixAborts.current).forEach(c => c.abort())
    pixAborts.current = {}
    setMode(m)
    setInputA('')
    setInputB('')
    resetFusion()
    setLoadingPixels({})
  }

  // ── Random mode ────────────────────────────────────────

  function shuffle() {
    Object.values(pixAborts.current).forEach(c => c.abort())
    pixAborts.current = {}
    setCandidateIds(randomIds(8))
    setFailedIds(new Set())
    setLoadingPixels({})
    resetFusion()
  }

  async function selectCandidate(id) {
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
    if (parentA && parentB) return

    const controller = new AbortController()
    pixAborts.current[id] = controller
    setLoadingPixels(prev => ({ ...prev, [id]: true }))

    try {
      const res = await fetch(`${API_BASE}/normie/${id}/pixels`, { signal: controller.signal })
      if (!res.ok) { setFailedIds(prev => new Set([...prev, id])); return }
      const raw = (await res.text()).trim()
      if (raw.length < 1600) { setFailedIds(prev => new Set([...prev, id])); return }

      const candidate = { id, pixels: raw.slice(0, 1600) }
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

  // ── IDs mode ──────────────────────────────────────────

  const idA = parseId(inputA)
  const idB = parseId(inputB)
  const bothIdsValid = idA !== null && idB !== null && idA !== idB

  // Fetch pixels for both IDs, then fuse
  async function fetchAndFuse(m, blend) {
    setComputing(true)
    setIdError(null)
    try {
      const [resA, resB] = await Promise.all([
        fetch(`${API_BASE}/normie/${idA}/pixels`),
        fetch(`${API_BASE}/normie/${idB}/pixels`),
      ])
      if (!resA.ok) throw new Error(`Normie #${idA} not found`)
      if (!resB.ok) throw new Error(`Normie #${idB} not found`)
      const [rawA, rawB] = await Promise.all([resA.text(), resB.text()])
      const pixA = rawA.trim().slice(0, 1600)
      const pixB = rawB.trim().slice(0, 1600)
      if (pixA.length < 1600) throw new Error(`Pixel data unavailable for #${idA}`)
      if (pixB.length < 1600) throw new Error(`Pixel data unavailable for #${idB}`)
      const pa = { id: idA, pixels: pixA }
      const pb = { id: idB, pixels: pixB }
      setParentA(pa)
      setParentB(pb)
      setFusedPixels(fusePixels(pixA, pixB, m, blend))
    } catch (err) {
      setIdError(err.message)
    } finally {
      setComputing(false)
    }
  }

  // ── Shared fusion controls ────────────────────────────

  function handleMethodSelect(m) {
    setMethod(m)
    if (mode === 'random') {
      // Pixels already available
      setFusedPixels(fusePixels(parentA.pixels, parentB.pixels, m, blendValue))
    } else {
      // IDs mode: fetch pixels then fuse (or re-fuse if already have them)
      if (parentA && parentB) {
        setFusedPixels(fusePixels(parentA.pixels, parentB.pixels, m, blendValue))
      } else {
        fetchAndFuse(m, blendValue)
      }
    }
  }

  function handleBlendChange(val) {
    setBlendValue(val)
    if (method === 'BLEND' && parentA && parentB) {
      setFusedPixels(fusePixels(parentA.pixels, parentB.pixels, 'BLEND', val))
    }
  }

  // Show method buttons once parents are ready
  const readyForMethod = mode === 'random'
    ? !!(parentA && parentB)
    : bothIdsValid

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
    setInputA('')
    setInputB('')
    setColorway('original')
    setComputing(false)
    resetFusion()
    if (mode === 'random') shuffle()
  }

  return (
    <div className="fusion-page">
      <header className="header">
        <h1 className="title">Normie Fusion</h1>
        <p className="subtitle">
          {collectionSize != null
            ? `${collectionSize.toLocaleString()} normies in collection`
            : 'Fuse two normies into one'}
        </p>
      </header>

      {/* Mode toggle */}
      <div className="fusion-section">
        <div className="mode-toggle">
          <button
            className={`effect-btn${mode === 'random' ? ' active' : ''}`}
            onClick={() => switchMode('random')}
          >
            Random
          </button>
          <button
            className={`effect-btn${mode === 'ids' ? ' active' : ''}`}
            onClick={() => switchMode('ids')}
          >
            Enter IDs
          </button>
        </div>
      </div>

      {/* ── Random mode ─────────────────────────────── */}
      {mode === 'random' && (
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
                    isA      ? 'parent-a'      : '',
                    isB      ? 'parent-b'      : '',
                    failed   ? 'card-failed'   : '',
                    fetching ? 'card-fetching' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => !failed && selectCandidate(id)}
                  disabled={fetching || (!isA && !isB && !!(parentA && parentB))}
                >
                  <img
                    src={`${API_BASE}/normie/${id}/image.svg`}
                    alt={`Normie #${id}`}
                    className="candidate-img"
                    onError={() => setFailedIds(prev => new Set([...prev, id]))}
                  />
                  <span className="candidate-id">#{id}</span>
                  {isA && <span className="candidate-badge">A</span>}
                  {isB && <span className="candidate-badge">B</span>}
                  {fetching && <div className="candidate-spinner"><div className="spinner" /></div>}
                  {failed   && <span className="candidate-burned">burned</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── IDs mode ────────────────────────────────── */}
      {mode === 'ids' && (
        <div className="fusion-section">
          <span className="section-label">Enter two token IDs (0 – 9999)</span>
          <div className="id-inputs-row">
            {/* Parent A */}
            <div className="id-input-block">
              <span className="id-input-label">Parent A</span>
              <input
                className="token-input id-input"
                type="number"
                min="0"
                max="9999"
                placeholder="0 – 9999"
                value={inputA}
                onChange={e => { setInputA(e.target.value); resetFusion() }}
              />
              {idA !== null && (
                <div className="id-preview">
                  <img
                    src={`${API_BASE}/normie/${idA}/image.svg`}
                    alt={`Normie #${idA}`}
                    className="id-preview-img"
                    onError={() => setIdError(`Normie #${idA} not found`)}
                  />
                  <span className="id-preview-label">#{idA}</span>
                </div>
              )}
            </div>

            <div className="id-inputs-divider">×</div>

            {/* Parent B */}
            <div className="id-input-block">
              <span className="id-input-label">Parent B</span>
              <input
                className="token-input id-input"
                type="number"
                min="0"
                max="9999"
                placeholder="0 – 9999"
                value={inputB}
                onChange={e => { setInputB(e.target.value); resetFusion() }}
              />
              {idB !== null && (
                <div className="id-preview">
                  <img
                    src={`${API_BASE}/normie/${idB}/image.svg`}
                    alt={`Normie #${idB}`}
                    className="id-preview-img"
                    onError={() => setIdError(`Normie #${idB} not found`)}
                  />
                  <span className="id-preview-label">#{idB}</span>
                </div>
              )}
            </div>
          </div>

          {idA !== null && idB !== null && idA === idB && (
            <p className="fusion-error">IDs must be different</p>
          )}
          {idError && <p className="fusion-error">{idError}</p>}
        </div>
      )}

      {/* ── Fusion method (shared) ──────────────────── */}
      {readyForMethod && (
        <div className="fusion-section">
          <span className="section-label">
            {mode === 'random'
              ? `Fusion method — #${parentA.id} × #${parentB.id}`
              : `Fusion method — #${idA} × #${idB}`}
          </span>
          {computing ? (
            <div className="loading">
              <div className="spinner" />
              <span>Fetching pixel data…</span>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {/* ── Result (shared) ────────────────────────── */}
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
