import { useState, useEffect, useRef } from 'react'
import './CorruptedPage.css'

const API_BASE = 'https://api.normies.art'
const GRID     = 40
const CELL     = 10
const DL_CELL  = 30
const BASE_ON  = '48494b'
const BASE_OFF = 'e3e5e4'

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

const EFFECTS = [
  { id: 'bitrot',         label: 'BIT ROT'        },
  { id: 'rowshift',       label: 'ROW SHIFT'       },
  { id: 'scancorrupt',    label: 'SCAN CORRUPT'    },
  { id: 'pixelbleed',     label: 'PIXEL BLEED'     },
  { id: 'dataloss',       label: 'DATA LOSS'       },
  { id: 'verticaltear',   label: 'VERTICAL TEAR'   },
  { id: 'edgedecay',      label: 'EDGE DECAY'      },
  { id: 'inversionzones', label: 'INVERSION ZONES' },
]

// ── Seeded random ─────────────────────────────────────────────────────────────

function srand(seed, s, i) {
  return Math.abs(Math.sin(seed * 1000 + s * 100 + i) * 10000) % 1
}

// ── Grid utils ────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function parsePixels(raw) {
  const g = []
  for (let r = 0; r < GRID; r++) {
    const row = []
    for (let c = 0; c < GRID; c++) row.push(raw[r * GRID + c] === '1')
    g.push(row)
  }
  return g
}

function boolToRgb(boolGrid, cw) {
  const on  = hexToRgb(cw.on)
  const off = hexToRgb(cw.off)
  return boolGrid.map(row => row.map(cell => cell ? [...on] : [...off]))
}

function cloneGrid(grid) {
  return grid.map(row => row.map(cell => [...cell]))
}

// ── Effects ───────────────────────────────────────────────────────────────────
// Each function mutates `grid` in place. buildOutput clones first.

function fxBitRot(grid, intensity, seed) {
  const t = intensity * 0.35
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (srand(seed, r, c) < t)
        grid[r][c] = [
          Math.floor(srand(seed + 1, r, c) * 255),
          Math.floor(srand(seed + 2, r, c) * 255),
          Math.floor(srand(seed + 3, r, c) * 255),
        ]
}

function fxRowShift(grid, intensity, seed) {
  const max = Math.max(1, Math.floor(intensity * GRID * 0.4))
  for (let r = 0; r < GRID; r++) {
    if (srand(seed, r, 99) < intensity * 0.55) {
      const shift = Math.floor(srand(seed, r, 100) * max * 2) - max
      if (!shift) continue
      const orig = grid[r].slice()
      for (let c = 0; c < GRID; c++)
        grid[r][c] = [...orig[((c - shift) % GRID + GRID) % GRID]]
    }
  }
}

function fxScanCorrupt(grid, intensity, seed) {
  const count = Math.max(1, Math.floor(intensity * GRID * 0.35))
  for (let i = 0; i < count; i++) {
    const r     = Math.floor(srand(seed, i, 55) * GRID)
    const color = [
      Math.floor(srand(seed, i, 56) * 255),
      Math.floor(srand(seed, i, 57) * 255),
      Math.floor(srand(seed, i, 58) * 255),
    ]
    const c0 = Math.floor(srand(seed, i, 59) * GRID * 0.3)
    const c1 = Math.min(GRID, c0 + Math.floor(srand(seed, i, 60) * GRID * 0.8) + Math.floor(GRID * 0.15))
    for (let c = c0; c < c1; c++) grid[r][c] = [...color]
  }
}

function fxPixelBleed(grid, intensity, seed) {
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (srand(seed, r, c + 200) < intensity * 0.1) {
        const len   = Math.floor(srand(seed, r, c + 201) * intensity * 12) + 1
        const color = [...grid[r][c]]
        for (let b = 1; b <= len && c + b < GRID; b++) grid[r][c + b] = [...color]
      }
}

function fxDataLoss(grid, intensity, seed) {
  const zones = Math.max(1, Math.floor(intensity * 5))
  for (let z = 0; z < zones; z++) {
    const r0    = Math.floor(srand(seed, z, 300) * GRID)
    const c0    = Math.floor(srand(seed, z, 301) * GRID)
    const h     = Math.max(1, Math.floor(srand(seed, z, 302) * intensity * GRID * 0.45))
    const w     = Math.max(2, Math.floor(srand(seed, z, 303) * GRID * 0.55))
    const color = srand(seed, z, 304) < 0.5 ? [0, 0, 0] : [255, 255, 255]
    for (let r = r0; r < Math.min(r0 + h, GRID); r++)
      for (let cc = c0; cc < Math.min(c0 + w, GRID); cc++)
        grid[r][cc] = [...color]
  }
}

function fxVerticalTear(grid, intensity, seed) {
  const max = Math.max(1, Math.floor(intensity * GRID * 0.4))
  for (let c = 0; c < GRID; c++) {
    if (srand(seed, c, 400) < intensity * 0.45) {
      const shift = Math.floor(srand(seed, c, 401) * max * 2) - max
      if (!shift) continue
      const col = grid.map(row => [...row[c]])
      for (let r = 0; r < GRID; r++)
        grid[r][c] = [...col[((r - shift) % GRID + GRID) % GRID]]
    }
  }
}

function fxEdgeDecay(grid, intensity, seed) {
  const depth = Math.max(1, Math.floor(intensity * 8))
  for (let d = 0; d < depth; d++) {
    const chance = (1 - d / depth) * intensity
    for (let c = 0; c < GRID; c++) {
      if (srand(seed, d, c + 500) < chance)          grid[d][c]        = [0, 0, 0]
      if (srand(seed, d + GRID, c + 500) < chance)   grid[GRID-1-d][c] = [0, 0, 0]
    }
    for (let r = 0; r < GRID; r++) {
      if (srand(seed, r + 600, d) < chance)           grid[r][d]        = [0, 0, 0]
      if (srand(seed, r + 700, d) < chance)           grid[r][GRID-1-d] = [0, 0, 0]
    }
  }
}

function fxInversionZones(grid, intensity, seed) {
  const zones = Math.max(1, Math.floor(intensity * 4) + 1)
  for (let z = 0; z < zones; z++) {
    const r0 = Math.floor(srand(seed, z, 800) * GRID)
    const c0 = Math.floor(srand(seed, z, 801) * GRID)
    const h  = Math.max(2, Math.floor(srand(seed, z, 802) * GRID * 0.5))
    const w  = Math.max(2, Math.floor(srand(seed, z, 803) * GRID * 0.5))
    for (let r = r0; r < Math.min(r0 + h, GRID); r++)
      for (let c = c0; c < Math.min(c0 + w, GRID); c++) {
        const [rv, gv, bv] = grid[r][c]
        grid[r][c] = [255 - rv, 255 - gv, 255 - bv]
      }
  }
}

const FX_ORDER = ['dataloss', 'bitrot', 'rowshift', 'verticaltear', 'pixelbleed', 'scancorrupt', 'edgedecay', 'inversionzones']
const FX_FNS   = {
  bitrot:         fxBitRot,
  rowshift:       fxRowShift,
  scancorrupt:    fxScanCorrupt,
  pixelbleed:     fxPixelBleed,
  dataloss:       fxDataLoss,
  verticaltear:   fxVerticalTear,
  edgedecay:      fxEdgeDecay,
  inversionzones: fxInversionZones,
}

function buildOutput(baseGrid, activeEffects, intensity, seed) {
  const grid = cloneGrid(baseGrid)
  for (const id of FX_ORDER)
    if (activeEffects.has(id)) FX_FNS[id](grid, intensity, seed)
  return grid
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderGrid(ctx, grid, cellSize) {
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      const [rv, gv, bv] = grid[r][c]
      ctx.fillStyle = `rgb(${rv},${gv},${bv})`
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize)
    }
}

// 6-frame dissolve: random pixel reveal from fromGrid → toGrid
function runDissolve(canvas, fromGrid, toGrid, rafRef, onDone) {
  const ctx    = canvas.getContext('2d')
  const FRAMES = 6
  const total  = GRID * GRID
  const cs     = Math.floor(canvas.width / GRID)

  // Seeded-shuffle reveal order
  const idx = Array.from({ length: total }, (_, i) => i)
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(srand(7, i, 0) * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }

  let frame = 0
  function step() {
    frame++
    const reveal  = Math.floor((frame / FRAMES) * total)
    const current = cloneGrid(fromGrid)
    for (let i = 0; i < reveal; i++) {
      const r = Math.floor(idx[i] / GRID)
      const c = idx[i] % GRID
      current[r][c] = toGrid[r][c]
    }
    renderGrid(ctx, current, cs)
    if (frame < FRAMES) {
      rafRef.current = requestAnimationFrame(step)
    } else {
      renderGrid(ctx, toGrid, cs)
      onDone?.()
    }
  }

  if (rafRef.current) cancelAnimationFrame(rafRef.current)
  rafRef.current = requestAnimationFrame(step)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CorruptedPage({ sharedId, onIdLoad }) {
  const [inputId,    setInputId]    = useState('')
  const [normieData, setNormieData] = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [colorway,   setColorway]   = useState('original')
  const [effects,    setEffects]    = useState(new Set())
  const [intensity,  setIntensity]  = useState(0.5)
  const [seedOffset, setSeedOffset] = useState(0)
  const [status,     setStatus]     = useState('')
  const [exporting,  setExporting]  = useState(false)

  const canvasRef     = useRef(null)
  const rafRef        = useRef(null)
  const boolGridRef   = useRef(null)    // raw 40×40 boolean grid
  const baseGridRef   = useRef(null)    // RGB grid with colorway applied
  const prevGridRef   = useRef(null)    // last rendered grid (for dissolve from-state)
  const effectsRef    = useRef(new Set())
  const intensityRef  = useRef(0.5)
  const seedOffsetRef = useRef(0)
  const normieIdRef   = useRef(null)
  const colorwayRef   = useRef('original')
  const svgTextRef    = useRef(null)

  // ── Core ──────────────────────────────────────────────────────────────────

  function rebuildBase(cwId) {
    if (!boolGridRef.current) return
    const cw = COLORWAYS.find(c => c.id === cwId) || COLORWAYS[0]
    baseGridRef.current = boolToRgb(boolGridRef.current, cw)
  }

  function redraw(animate) {
    if (!baseGridRef.current || !canvasRef.current) return
    const seed    = (normieIdRef.current ?? 0) + seedOffsetRef.current
    const canvas  = canvasRef.current
    const ctx     = canvas.getContext('2d')
    const outGrid = buildOutput(baseGridRef.current, effectsRef.current, intensityRef.current, seed)
    const n       = effectsRef.current.size
    const txt     = n ? `${n} effect${n > 1 ? 's' : ''} active` : 'clean'

    if (animate && prevGridRef.current) {
      runDissolve(canvas, prevGridRef.current, outGrid, rafRef, () => {
        prevGridRef.current = outGrid
        setStatus(txt)
      })
    } else {
      renderGrid(ctx, outGrid, CELL)
      prevGridRef.current = outGrid
      setStatus(txt)
    }
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async function loadById(id) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setLoading(true)
    setError(null)
    setNormieData(null)
    boolGridRef.current   = null
    baseGridRef.current   = null
    prevGridRef.current   = null
    normieIdRef.current   = id
    effectsRef.current    = new Set()
    seedOffsetRef.current = 0
    setEffects(new Set())
    setSeedOffset(0)
    setStatus('loading...')

    try {
      const [pxRes, svgRes, metaRes] = await Promise.all([
        fetch(`${API_BASE}/normie/${id}/pixels`),
        fetch(`${API_BASE}/normie/${id}/image.svg`),
        fetch(`${API_BASE}/normie/${id}/metadata`),
      ])
      if (!pxRes.ok) throw new Error(`Token #${id} not found (${pxRes.status})`)

      const [raw, svgText, meta] = await Promise.all([pxRes.text(), svgRes.text(), metaRes.json()])
      const trimmed = raw.trim()
      if (trimmed.length < GRID * GRID) throw new Error(`Pixel data unavailable for #${id}`)

      boolGridRef.current = parsePixels(trimmed.slice(0, GRID * GRID))
      svgTextRef.current  = svgText
      rebuildBase(colorwayRef.current)

      const attrs = meta.attributes ?? meta
      setNormieData({ id, traits: attrs })
      onIdLoad?.(id)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  function handleLoad() {
    const id = parseInt(inputId, 10)
    if (isNaN(id) || id < 0 || id > 9999) {
      setError('Please enter a valid token ID between 0 and 9999.')
      return
    }
    setError(null)
    loadById(id)
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  function toggleEffect(id) {
    const next = new Set(effectsRef.current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    effectsRef.current = next
    setEffects(new Set(next))
    redraw(true)
  }

  function handleIntensity(val) {
    intensityRef.current = val
    setIntensity(val)
    redraw(false)
  }

  function handleColorway(cwId) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    colorwayRef.current = cwId
    setColorway(cwId)
    if (!boolGridRef.current) return
    prevGridRef.current = null
    rebuildBase(cwId)
    redraw(false)
  }

  function handleRandomize() {
    const offset = Math.floor(Math.random() * 9000) + 1
    seedOffsetRef.current = offset
    setSeedOffset(offset)
    redraw(true)
  }

  function handleReset() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    effectsRef.current    = new Set()
    intensityRef.current  = 0.5
    seedOffsetRef.current = 0
    setEffects(new Set())
    setIntensity(0.5)
    setSeedOffset(0)
    redraw(false)
  }

  // ── Draw on normie load ────────────────────────────────────────────────────

  useEffect(() => {
    if (!normieData || !baseGridRef.current) return
    redraw(false)
  }, [normieData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── sharedId sync ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (sharedId === null || sharedId === normieIdRef.current) return
    setInputId(String(sharedId))
    loadById(sharedId)
  }, [sharedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Download ──────────────────────────────────────────────────────────────

  async function handleDownload() {
    if (!baseGridRef.current || !normieData) return
    setExporting(true)
    try {
      const seed = normieIdRef.current + seedOffsetRef.current
      const out  = buildOutput(baseGridRef.current, effectsRef.current, intensityRef.current, seed)
      const dl   = document.createElement('canvas')
      dl.width   = GRID * DL_CELL
      dl.height  = GRID * DL_CELL
      renderGrid(dl.getContext('2d'), out, DL_CELL)
      await new Promise(resolve => {
        dl.toBlob(blob => {
          const url = URL.createObjectURL(blob)
          const a   = document.createElement('a')
          a.href     = url
          a.download = `normie-${normieData.id}-corrupted.png`
          a.click()
          URL.revokeObjectURL(url)
          resolve()
        }, 'image/png')
      })
    } finally {
      setExporting(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const activeCw  = COLORWAYS.find(c => c.id === colorway) || COLORWAYS[0]
  const thumbSrc  = normieData && svgTextRef.current
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        svgTextRef.current.replace(
          new RegExp(`#(${BASE_ON}|${BASE_OFF})`, 'gi'),
          (m, h) => h.toLowerCase() === BASE_ON ? activeCw.on : activeCw.off
        )
      )}`
    : null

  const traitPills = normieData
    ? (Array.isArray(normieData.traits)
        ? normieData.traits.slice(0, 4).map(t => String(t.value ?? ''))
        : Object.values(normieData.traits).slice(0, 4).map(v => String(v)))
    : []

  return (
    <div className="corrupted-page">

      <div className="corrupted-input-row">
        <input
          className="corrupted-token-input"
          type="number"
          min="0"
          max="9999"
          placeholder="Token ID"
          value={inputId}
          onChange={e => setInputId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLoad()}
        />
        <button className="corrupted-load-btn" onClick={handleLoad} disabled={loading}>
          {loading ? '...' : 'Load'}
        </button>
      </div>

      {error && <p className="corrupted-error">{error}</p>}

      {normieData && (
        <>
          <div className="corrupted-normie-info">
            {thumbSrc && (
              <img className="corrupted-thumb" src={thumbSrc} alt={`Normie #${normieData.id}`} />
            )}
            <div className="corrupted-normie-details">
              <div className="corrupted-normie-name">Normie #{normieData.id}</div>
              <div className="corrupted-trait-pills">
                {traitPills.map((v, i) => (
                  <span key={i} className="corrupted-trait-pill">{v}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="corrupted-intensity-bar">
            <span className="corrupted-label">Intensity</span>
            <input
              type="range"
              className="corrupted-slider"
              min="0"
              max="1"
              step="0.01"
              value={intensity}
              onChange={e => handleIntensity(parseFloat(e.target.value))}
            />
            <span className="corrupted-val">{Math.round(intensity * 100)}%</span>
          </div>

          <div className="corrupted-effects">
            {EFFECTS.map(fx => (
              <button
                key={fx.id}
                className={`corrupted-fx-btn${effects.has(fx.id) ? ' active' : ''}`}
                onClick={() => toggleEffect(fx.id)}
              >
                {fx.label}
              </button>
            ))}
          </div>

          <div className="corrupted-colorways">
            {COLORWAYS.map(cw => (
              <button
                key={cw.id}
                className={`corrupted-cw-btn${colorway === cw.id ? ' active' : ''}`}
                onClick={() => handleColorway(cw.id)}
              >
                {cw.label}
              </button>
            ))}
          </div>

          <div className="corrupted-seed-row">
            <button className="corrupted-action-btn" onClick={handleRandomize}>
              Randomize Seed
            </button>
            <span className="corrupted-status">{status}</span>
            <button className="corrupted-action-btn" onClick={handleReset}>
              Reset All
            </button>
          </div>

          <div className="corrupted-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="corrupted-canvas"
              width={GRID * CELL}
              height={GRID * CELL}
            />
          </div>

          <button
            className="corrupted-download-btn"
            onClick={handleDownload}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Download 1200×1200 PNG'}
          </button>
        </>
      )}
    </div>
  )
}
