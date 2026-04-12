import { useState, useEffect, useRef } from 'react'
import './DataPage.css'

const API_BASE = 'https://api.normies.art'
const GRID = 40
const CELL = 10
const SIZE = 400

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

const VIZ_NAMES   = ['CONSTELLATION', 'WAVEFORM', 'HEATMAP', 'FINGERPRINT', 'MIRROR']
const MIRROR_MODES = ['HORIZONTAL', 'VERTICAL', 'QUAD', 'KALEIDOSCOPE']

// ── Helpers ───────────────────────────────────────────────

function hexRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}

function lerpColor(hex0, hex1, t) {
  const [r0,g0,b0] = hexRgb(hex0)
  const [r1,g1,b1] = hexRgb(hex1)
  return `rgb(${Math.round(r0+(r1-r0)*t)},${Math.round(g0+(g1-g0)*t)},${Math.round(b0+(b1-b0)*t)})`
}

function parseGrid(str) {
  const g = []
  for (let y = 0; y < GRID; y++) {
    const row = []
    for (let x = 0; x < GRID; x++) row.push(str[y*GRID+x] === '1')
    g.push(row)
  }
  return g
}

function rowCounts(grid) {
  return grid.map(row => row.filter(Boolean).length)
}

// ── Visualization draw functions ──────────────────────────

function drawWaveform(ctx, grid, cw) {
  ctx.fillStyle = cw.off
  ctx.fillRect(0, 0, SIZE, SIZE)

  const counts = rowCounts(grid)
  const maxC   = Math.max(...counts)
  const minC   = Math.min(...counts)

  // 5-point moving average
  const smooth = counts.map((_, i) => {
    let sum = 0, n = 0
    for (let w = -2; w <= 2; w++) {
      const idx = i + w
      if (idx >= 0 && idx < GRID) { sum += counts[idx]; n++ }
    }
    return sum / n
  })

  const centerY = SIZE / 2
  const MAX_H   = 178
  const barW    = SIZE / GRID  // 10px

  ctx.fillStyle = cw.on
  for (let i = 0; i < GRID; i++) {
    const h = Math.max(1, (smooth[i] / 40) * MAX_H)
    const x = i * barW
    ctx.fillRect(x,          centerY - h, barW - 1, h)
    ctx.fillRect(x, centerY + 1,          barW - 1, h)
  }

  // Baseline + labels
  ctx.globalAlpha = 0.35
  ctx.fillRect(0, centerY, SIZE, 1)
  ctx.globalAlpha = 0.55
  ctx.font = '9px "Courier New", monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`max: ${maxC}`, 4, 4)
  ctx.fillText(`min: ${minC}`, 4, SIZE - 14)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('0', SIZE - 4, centerY - 2)
  ctx.globalAlpha = 1
}

function drawHeatmap(ctx, grid, cw) {
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      let density = 0
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r+dr, nc = c+dc
          if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID && grid[nr][nc]) density++
        }
      ctx.fillStyle = lerpColor(cw.off, cw.on, density / 9)
      ctx.fillRect(c*CELL, r*CELL, CELL, CELL)
    }
}

function drawFingerprint(ctx, grid, cw) {
  ctx.fillStyle = cw.off
  ctx.fillRect(0, 0, SIZE, SIZE)

  const cx = SIZE / 2, cy = SIZE / 2
  const counts = rowCounts(grid)

  // Map each row's count to a radius, sort descending
  const radii = counts.map(c => 5 + (c / 40) * 190)
  const sorted = [...radii].sort((a, b) => b - a)

  ctx.strokeStyle = cw.on
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.65
  for (const r of sorted) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawMirror(ctx, grid, cw, mode) {
  ctx.fillStyle = cw.off
  ctx.fillRect(0, 0, SIZE, SIZE)

  ctx.fillStyle = cw.on
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      let on
      if (mode === 'HORIZONTAL') {
        on = grid[r][c < 20 ? c : 39 - c]
      } else if (mode === 'VERTICAL') {
        on = grid[r < 20 ? r : 39 - r][c]
      } else if (mode === 'QUAD') {
        on = grid[r < 20 ? r : 39 - r][c < 20 ? c : 39 - c]
      } else {
        // KALEIDOSCOPE — fold to first octant (|dr| >= |dc|)
        const absDr = Math.abs(r - 19.5)
        const absDc = Math.abs(c - 19.5)
        const foldR = Math.max(absDr, absDc)
        const foldC = Math.min(absDr, absDc)
        const srcR  = Math.min(39, Math.floor(19.5 + foldR))
        const srcC  = Math.min(39, Math.floor(19.5 + foldC))
        on = grid[srcR][srcC]
      }
      if (on) ctx.fillRect(c*CELL, r*CELL, CELL, CELL)
    }
}

// ── Component ─────────────────────────────────────────────

export default function DataPage() {
  const [inputId,   setInputId]   = useState('')
  const [normieId,  setNormieId]  = useState(null)
  const [grid,      setGrid]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [viz,       setViz]       = useState('CONSTELLATION')
  const [mirrorMode,setMirrorMode]= useState('HORIZONTAL')
  const [colorway,  setColorway]  = useState('original')

  const canvasRef = useRef(null)

  async function loadNormie() {
    const id = parseInt(inputId, 10)
    if (isNaN(id) || id < 0 || id > 9999) {
      setError('Please enter a valid token ID between 0 and 9999.')
      return
    }
    setLoading(true)
    setError(null)
    setGrid(null)
    setNormieId(null)
    setViz('CONSTELLATION')
    setColorway('original')
    try {
      const res = await fetch(`${API_BASE}/normie/${id}/pixels`)
      if (!res.ok) throw new Error(`Token #${id} not found (${res.status})`)
      const raw = (await res.text()).trim()
      if (raw.length < 1600) throw new Error(`Pixel data unavailable for #${id}`)
      setGrid(parseGrid(raw.slice(0, 1600)))
      setNormieId(id)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') loadNormie()
  }

  function downloadPng() {
    const canvas = canvasRef.current
    if (!canvas || normieId === null) return
    const out  = document.createElement('canvas')
    out.width  = 1200
    out.height = 1200
    const octx = out.getContext('2d')
    octx.imageSmoothingEnabled = false
    octx.drawImage(canvas, 0, 0, 1200, 1200)
    const slug = viz === 'MIRROR' ? `mirror-${mirrorMode.toLowerCase()}` : viz.toLowerCase()
    out.toBlob(blob => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `normie-${normieId}-${slug}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    }, 'image/png')
  }

  // ── Draw effect ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const cw  = COLORWAYS.find(c => c.id === colorway)
    let rafId = null

    if (!grid) {
      ctx.fillStyle = cw.off
      ctx.fillRect(0, 0, SIZE, SIZE)
      return
    }

    // ── CONSTELLATION ──────────────────────────────────────
    if (viz === 'CONSTELLATION') {
      // Precompute dots and near pairs once
      const dots = []
      for (let r = 0; r < GRID; r++)
        for (let c = 0; c < GRID; c++)
          if (grid[r][c]) dots.push({ x: c*CELL + CELL/2, y: r*CELL + CELL/2 })

      const pairs = []
      for (let i = 0; i < dots.length; i++)
        for (let j = i+1; j < dots.length; j++) {
          const dx   = dots[i].x - dots[j].x
          const dy   = dots[i].y - dots[j].y
          const dist = Math.sqrt(dx*dx + dy*dy)
          if (dist < 30)
            pairs.push({ ax: dots[i].x, ay: dots[i].y, bx: dots[j].x, by: dots[j].y, alpha: (1 - dist/30) * 0.65 })
        }

      function frameConst(now) {
        ctx.fillStyle = cw.off
        ctx.fillRect(0, 0, SIZE, SIZE)

        ctx.strokeStyle = cw.on
        ctx.lineWidth   = 1
        for (const { ax, ay, bx, by, alpha } of pairs) {
          ctx.globalAlpha = alpha
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
        }

        const pulse = 2 + Math.sin(now / 2000 * Math.PI * 2) * 0.8
        ctx.globalAlpha = 1
        ctx.fillStyle   = cw.on
        for (const d of dots) {
          ctx.beginPath(); ctx.arc(d.x, d.y, pulse, 0, Math.PI * 2); ctx.fill()
        }

        rafId = requestAnimationFrame(frameConst)
      }
      rafId = requestAnimationFrame(frameConst)

    // ── WAVEFORM ──────────────────────────────────────────
    } else if (viz === 'WAVEFORM') {
      drawWaveform(ctx, grid, cw)

    // ── HEATMAP ───────────────────────────────────────────
    } else if (viz === 'HEATMAP') {
      drawHeatmap(ctx, grid, cw)

    // ── FINGERPRINT ───────────────────────────────────────
    } else if (viz === 'FINGERPRINT') {
      drawFingerprint(ctx, grid, cw)

    // ── MIRROR ────────────────────────────────────────────
    } else if (viz === 'MIRROR') {
      drawMirror(ctx, grid, cw, mirrorMode)
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [grid, viz, colorway, mirrorMode])

  return (
    <div className="data-page">
      <header className="header">
        <h1 className="title">Data Art</h1>
        <p className="subtitle">Enter a Token ID to Begin</p>
      </header>

      <div className="input-row">
        <input
          className="token-input"
          type="number"
          min="0"
          max="9999"
          placeholder="Token ID (0–9999)"
          value={inputId}
          onChange={e => setInputId(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="load-btn" onClick={loadNormie} disabled={loading}>
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <span>Fetching Normie…</span>
        </div>
      )}

      <div className="data-canvas-wrap">
        <canvas ref={canvasRef} width={SIZE} height={SIZE} className="data-canvas" />
      </div>

      {/* Visualization selector */}
      <div className="viz-selector">
        {VIZ_NAMES.map(name => (
          <button
            key={name}
            className={`viz-btn${viz === name ? ' active' : ''}`}
            onClick={() => setViz(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Mirror sub-selector */}
      {viz === 'MIRROR' && (
        <div className="mirror-selector">
          {MIRROR_MODES.map(m => (
            <button
              key={m}
              className={`mirror-btn${mirrorMode === m ? ' active' : ''}`}
              onClick={() => setMirrorMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {/* Colorways + download */}
      {grid && (
        <div className="effects-panel data-panel">
          <span className="effects-label">Colorways</span>
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
            disabled={normieId === null}
          >
            Download PNG
          </button>
        </div>
      )}
    </div>
  )
}
