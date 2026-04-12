import { useState, useEffect, useRef } from 'react'
import GIF from 'gif.js'
import { shareOrDownload } from './share'
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

const VIZ_NAMES    = ['CONSTELLATION', 'WAVEFORM', 'HEATMAP', 'FINGERPRINT', 'MIRROR']
const MIRROR_MODES = ['HORIZONTAL', 'VERTICAL', 'QUAD', 'KALEIDOSCOPE']

const VIZ_DESCRIPTIONS = {
  CONSTELLATION:
    'Each ON pixel becomes a node plotted at its canvas position. Edges connect any two nodes within 30 pixels of each other — line opacity scales with proximity, so near neighbors read as stronger bonds. The structure maps the pixel density as a living circuit graph.',
  WAVEFORM:
    'Each of the 40 rows is collapsed to a single amplitude: its ON pixel count. Those values are smoothed with a 5-point moving average, then reflected symmetrically above and below the center axis — the Normie rendered as its own audio signature.',
  HEATMAP:
    'A 3×3 sampling window sweeps every cell in the grid, counting active neighbors to produce a local density score from 0 to 9. That score is linearly interpolated between the background and foreground colors, surfacing the mass distribution as a thermal signature.',
  FINGERPRINT:
    'The ON pixel count of each row maps directly to a ring radius, ranging from 5 to 195 pixels. All 40 rings are drawn from outermost inward, their irregular spacing encoding the row-by-row density profile. The pattern is deterministic and unique to every token.',
}

const MIRROR_DESCRIPTIONS = {
  HORIZONTAL:
    'The left 20 columns are preserved as source. The right half is discarded and rebuilt as their mirror image across the vertical axis — bilateral symmetry derived directly from the pixel data.',
  VERTICAL:
    'The top 20 rows form the source. The bottom half is discarded and rebuilt as their reflection across the horizontal axis, producing vertical symmetry from a single half of the original grid.',
  QUAD:
    'Both axes fold simultaneously. The top-left quadrant becomes the sole source, reflected horizontally, vertically, and diagonally to fill all four corners — fourfold symmetry from one corner of the grid.',
  KALEIDOSCOPE:
    "Each pixel's distance from center is decomposed into its principal and tangential components, then folded into a single 45° wedge. That octant tiles outward through eight reflections, collapsing the full grid into a radial mandala.",
}

// GIF record durations — only for animated vizzes
const GIF_DURATIONS = {
  CONSTELLATION: 3000,
  FINGERPRINT:   2600,  // one ripple cycle at 2.5 rad/s
}

const ANIMATED_VIZZES = new Set(['CONSTELLATION', 'FINGERPRINT'])

// ── Helpers ───────────────────────────────────────────────

function lerpColor(hex0, hex1, t) {
  const h0 = hex0.replace('#', ''), h1 = hex1.replace('#', '')
  const r0 = parseInt(h0.slice(0,2),16), g0 = parseInt(h0.slice(2,4),16), b0 = parseInt(h0.slice(4,6),16)
  const r1 = parseInt(h1.slice(0,2),16), g1 = parseInt(h1.slice(2,4),16), b1 = parseInt(h1.slice(4,6),16)
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

// Used by MIRROR to paint onto an offscreen canvas before rotating
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
        const absDr = Math.abs(r - 19.5), absDc = Math.abs(c - 19.5)
        const srcR  = Math.min(39, Math.floor(19.5 + Math.max(absDr, absDc)))
        const srcC  = Math.min(39, Math.floor(19.5 + Math.min(absDr, absDc)))
        on = grid[srcR][srcC]
      }
      if (on) ctx.fillRect(c*CELL, r*CELL, CELL, CELL)
    }
}

// ── Component ─────────────────────────────────────────────

export default function DataPage({ sharedId = null, onIdLoad } = {}) {
  const [inputId,    setInputId]    = useState('')
  const [normieId,   setNormieId]   = useState(null)
  const [grid,       setGrid]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [viz,        setViz]        = useState('CONSTELLATION')
  const [mirrorMode, setMirrorMode] = useState('HORIZONTAL')
  const [colorway,   setColorway]   = useState('original')
  const [gifState,   setGifState]   = useState(null) // null | 'recording' | 'encoding'

  const canvasRef = useRef(null)

  async function loadById(id) {
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
      onIdLoad?.(id)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  async function loadNormie() {
    const id = parseInt(inputId, 10)
    if (isNaN(id) || id < 0 || id > 9999) {
      setError('Please enter a valid token ID between 0 and 9999.')
      return
    }
    await loadById(id)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') loadNormie()
  }

  // Auto-load when sharedId changes from another page
  useEffect(() => {
    if (sharedId === null || sharedId === normieId) return
    setInputId(String(sharedId))
    loadById(sharedId)
  }, [sharedId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    out.toBlob(async blob => {
      await shareOrDownload(blob, `normie-${normieId}-${slug}.png`)
    }, 'image/png')
  }

  async function downloadGif() {
    const canvas = canvasRef.current
    if (!canvas || normieId === null || gifState !== null) return

    const FPS        = 15
    const FRAME_MS   = Math.round(1000 / FPS)
    const duration   = GIF_DURATIONS[viz] ?? 3000
    const totalFrames = Math.max(2, Math.ceil(duration / FRAME_MS))
    const OUT        = 600
    const slug       = viz === 'MIRROR' ? `mirror-${mirrorMode.toLowerCase()}` : viz.toLowerCase()

    setGifState('recording')
    try {
      const gif = new GIF({
        workers: 2, quality: 10,
        width: OUT, height: OUT,
        workerScript: '/gif.worker.js',
        repeat: 0,
      })
      await new Promise(resolve => {
        let count = 0
        const interval = setInterval(() => {
          const frame = document.createElement('canvas')
          frame.width = OUT; frame.height = OUT
          const fCtx = frame.getContext('2d')
          fCtx.imageSmoothingEnabled = false
          fCtx.drawImage(canvas, 0, 0, OUT, OUT)
          gif.addFrame(frame, { delay: FRAME_MS, copy: true })
          if (++count >= totalFrames) { clearInterval(interval); resolve() }
        }, FRAME_MS)
      })
      setGifState('encoding')
      await new Promise((resolve, reject) => {
        gif.on('finished', async blob => {
          await shareOrDownload(blob, `normie-${normieId}-${slug}.gif`)
          resolve()
        })
        gif.on('abort', () => reject(new Error('GIF aborted')))
        gif.render()
      })
    } catch (err) {
      console.error('GIF export failed:', err)
    } finally {
      setGifState(null)
    }
  }

  // ── Animation loop ────────────────────────────────────────
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
      const dots = []
      for (let r = 0; r < GRID; r++)
        for (let c = 0; c < GRID; c++)
          if (grid[r][c]) dots.push({ x: c*CELL+CELL/2, y: r*CELL+CELL/2 })

      const pairs = []
      for (let i = 0; i < dots.length; i++)
        for (let j = i+1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y
          const dist = Math.sqrt(dx*dx + dy*dy)
          if (dist < 30)
            pairs.push({ ax: dots[i].x, ay: dots[i].y, bx: dots[j].x, by: dots[j].y, alpha: (1 - dist/30) * 0.65 })
        }

      function frameConst(now) {
        ctx.fillStyle = cw.off
        ctx.fillRect(0, 0, SIZE, SIZE)
        ctx.strokeStyle = cw.on
        ctx.lineWidth = 1
        for (const { ax, ay, bx, by, alpha } of pairs) {
          ctx.globalAlpha = alpha
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
        }
        const pulse = 2 + Math.sin(now / 2000 * Math.PI * 2) * 0.8
        ctx.globalAlpha = 1
        ctx.fillStyle = cw.on
        for (const d of dots) {
          ctx.beginPath(); ctx.arc(d.x, d.y, pulse, 0, Math.PI * 2); ctx.fill()
        }
        rafId = requestAnimationFrame(frameConst)
      }
      rafId = requestAnimationFrame(frameConst)

    // ── WAVEFORM — static ──────────────────────────────────
    } else if (viz === 'WAVEFORM') {
      const counts  = rowCounts(grid)
      const maxC    = Math.max(...counts)
      const minC    = Math.min(...counts)
      const smooth  = counts.map((_, i) => {
        let sum = 0, n = 0
        for (let w = -2; w <= 2; w++) {
          const idx = i + w
          if (idx >= 0 && idx < GRID) { sum += counts[idx]; n++ }
        }
        return sum / n
      })
      const centerY = SIZE / 2
      const MAX_H   = 178
      const barW    = SIZE / GRID

      ctx.fillStyle = cw.off
      ctx.fillRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = cw.on
      for (let i = 0; i < GRID; i++) {
        const h = Math.max(1, (smooth[i] / 40) * MAX_H)
        const x = i * barW
        ctx.fillRect(x, centerY - h, barW - 1, h)
        ctx.fillRect(x, centerY + 1, barW - 1, h)
      }
      ctx.globalAlpha = 0.35
      ctx.fillRect(0, centerY, SIZE, 1)
      ctx.globalAlpha = 0.55
      ctx.font = '9px "Courier New", monospace'
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      ctx.fillText(`max: ${maxC}`, 4, 4)
      ctx.fillText(`min: ${minC}`, 4, SIZE - 14)
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
      ctx.fillText('0', SIZE - 4, centerY - 2)
      ctx.globalAlpha = 1

    // ── HEATMAP — static ───────────────────────────────────
    } else if (viz === 'HEATMAP') {
      for (let r = 0; r < GRID; r++)
        for (let c = 0; c < GRID; c++) {
          let d = 0
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r+dr, nc = c+dc
              if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID && grid[nr][nc]) d++
            }
          ctx.fillStyle = lerpColor(cw.off, cw.on, d / 9)
          ctx.fillRect(c*CELL, r*CELL, CELL, CELL)
        }

    // ── FINGERPRINT — outward ripple waves ─────────────────
    } else if (viz === 'FINGERPRINT') {
      const counts    = rowCounts(grid)
      const baseRadii = counts.map(c => 5 + (c / 40) * 190)
      // Sort once; animation modifies radii dynamically
      const sorted = baseRadii
        .map((r, i) => ({ base: r, i }))
        .sort((a, b) => b.base - a.base)

      const cx = SIZE / 2, cy = SIZE / 2

      function frameFingerprint(now) {
        ctx.fillStyle = cw.off
        ctx.fillRect(0, 0, SIZE, SIZE)
        ctx.strokeStyle = cw.on
        ctx.lineWidth   = 1
        ctx.globalAlpha = 0.65

        const t = now / 1000
        for (const { base } of sorted) {
          // Phase depends on base radius → wave propagates outward from center
          const animR = base + Math.sin(t * 2.5 - base * 0.06) * 6
          if (animR > 0) {
            ctx.beginPath()
            ctx.arc(cx, cy, animR, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
        ctx.globalAlpha = 1
        rafId = requestAnimationFrame(frameFingerprint)
      }
      rafId = requestAnimationFrame(frameFingerprint)

    // ── MIRROR — static ────────────────────────────────────
    } else if (viz === 'MIRROR') {
      drawMirror(ctx, grid, cw, mirrorMode)
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [grid, viz, colorway, mirrorMode])

  const busy = gifState !== null

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

      {/* Visualization description */}
      <p className="viz-description">
        {viz === 'MIRROR' ? MIRROR_DESCRIPTIONS[mirrorMode] : VIZ_DESCRIPTIONS[viz]}
      </p>

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
          <div className="download-row">
            <button className="download-btn" onClick={downloadPng} disabled={normieId === null || busy}>
              Download PNG
            </button>
            {ANIMATED_VIZZES.has(viz) && (
              <button className="download-btn" onClick={downloadGif} disabled={normieId === null || busy}>
                {gifState === 'recording' ? 'Recording…' : gifState === 'encoding' ? 'Encoding…' : 'Download GIF'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
