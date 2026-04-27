import { useState, useEffect, useRef } from 'react'
import GIF from 'gif.js'
import { shareOrDownload } from './share'
import './GifsPage.css'

const API_BASE = 'https://api.normies.art'
const GRID = 40
const CELL = 10
const SIZE = 400

const CW_ORIGINAL = { on: '#48494b', off: '#e3e5e4' }
const CW_GHOST    = { on: '#ffffff', off: '#111111' }

const GOLD_COLORS = ['#FFD700', '#FFC200', '#FFCC00', '#F0A500', '#E8C000', '#FFB300', '#FFCA28']

const ETCH_W      = 500
const ETCH_H      = 560
const ETCH_SX     = 50
const ETCH_SY     = 50
const ETCH_SCREEN = '#bfbca8'
const ETCH_DRAWN  = '#252323'

function parseGrid(str) {
  const g = []
  for (let y = 0; y < GRID; y++) {
    const row = []
    for (let x = 0; x < GRID; x++) row.push(str[y * GRID + x] === '1')
    g.push(row)
  }
  return g
}

function drawPixels(ctx, grid, cw) {
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      ctx.fillStyle = grid[y][x] ? cw.on : cw.off
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
    }
}

function spawnParticle() {
  return {
    x: Math.random() * SIZE,
    y: -8,
    vx: (Math.random() - 0.5) * 1.8,
    vy: Math.random() * 1.5 + 0.8,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.18,
    color: GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)],
    size: Math.random() * 3.5 + 2,
    alpha: 1,
  }
}

// Serpentine scan: row 0 L→R, row 1 R→L, etc.
function buildEtchPath() {
  const path = []
  for (let y = 0; y < GRID; y++) {
    if (y % 2 === 0) {
      for (let x = 0; x < GRID; x++) path.push({ x, y })
    } else {
      for (let x = GRID - 1; x >= 0; x--) path.push({ x, y })
    }
  }
  return path
}

function drawEtchDial(ctx, cx, cy, r, angle) {
  ctx.save()
  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.beginPath()
  ctx.arc(cx + 2, cy + 2, r + 2, 0, Math.PI * 2)
  ctx.fill()
  // Outer ring
  ctx.fillStyle = '#600'
  ctx.beginPath()
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
  ctx.fill()
  // Gradient knob body
  const gr = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.28, r * 0.05, cx, cy, r)
  gr.addColorStop(0, '#f04040')
  gr.addColorStop(1, '#7a0000')
  ctx.fillStyle = gr
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  // Grip notches
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx + (r - 6) * Math.sin(a), cy - (r - 6) * Math.cos(a))
    ctx.lineTo(cx + r * Math.sin(a),        cy - r * Math.cos(a))
    ctx.stroke()
  }
  // Rotating indicator
  ctx.strokeStyle = 'rgba(255,255,255,0.88)'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + (r - 8) * Math.sin(angle), cy - (r - 8) * Math.cos(angle))
  ctx.stroke()
  // Center dot
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.arc(cx, cy, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawEtchFrame(eCtx, off, cursorIdx, path, xDist, yDist) {
  // Outer body — silver-gray
  eCtx.fillStyle = '#8a8a8a'
  eCtx.fillRect(0, 0, ETCH_W, ETCH_H)
  eCtx.fillStyle = '#c2c2c2'
  eCtx.fillRect(5, 5, ETCH_W - 10, ETCH_H - 10)
  // Dark corner accents (simulate rounded frame)
  const cr = 16
  eCtx.fillStyle = '#8a8a8a'
  ;[[0,0],[ETCH_W-cr,0],[0,ETCH_H-cr],[ETCH_W-cr,ETCH_H-cr]].forEach(([rx,ry]) => {
    eCtx.fillRect(rx, ry, cr, cr)
  })
  // Screen bezel
  eCtx.fillStyle = '#606060'
  eCtx.fillRect(ETCH_SX - 14, ETCH_SY - 14, 428, 428)
  eCtx.fillStyle = '#404040'
  eCtx.fillRect(ETCH_SX - 10, ETCH_SY - 10, 420, 420)
  // Screen content (accumulated drawing)
  eCtx.drawImage(off, ETCH_SX, ETCH_SY)

  // Cursor
  if (cursorIdx !== null) {
    const { x, y } = path[cursorIdx]
    const px = ETCH_SX + x * CELL + CELL / 2
    const py = ETCH_SY + y * CELL + CELL / 2
    eCtx.fillStyle = 'rgba(255, 50, 50, 0.18)'
    eCtx.beginPath()
    eCtx.arc(px, py, 11, 0, Math.PI * 2)
    eCtx.fill()
    eCtx.fillStyle = '#ff2020'
    eCtx.beginPath()
    eCtx.arc(px, py, 3.5, 0, Math.PI * 2)
    eCtx.fill()
  }

  // Dials — X spins fast during row sweeps, Y jumps at row transitions
  // Both complete ~9.75 full rotations over the full drawing
  const xAngle = (xDist / 160) * Math.PI * 2
  const yAngle = (yDist / 4)   * Math.PI * 2
  drawEtchDial(eCtx, 78, 510, 34, xAngle)
  drawEtchDial(eCtx, 422, 510, 34, yAngle)

  // Labels
  eCtx.fillStyle = '#4a4a4a'
  eCtx.font = 'bold 12px "Courier New"'
  eCtx.textAlign = 'center'
  eCtx.fillText('ETCH IT', 250, 500)
  eCtx.fillStyle = '#888'
  eCtx.font = '9px "Courier New"'
  eCtx.fillText('NORMIES.ART', 250, 518)
}

const EFFECTS = [
  { id: 'celebration',   label: 'Celebration' },
  { id: 'chromatic-rip', label: 'Chromatic Rip' },
  { id: 'etch-it',       label: 'Etch It' },
]

export default function GifsPage({ sharedId = null, onIdLoad } = {}) {
  const [inputId,      setInputId]      = useState('')
  const [normieId,     setNormieId]     = useState(null)
  const [grid,         setGrid]         = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [effect,       setEffect]       = useState('celebration')
  const [effectPicked, setEffectPicked] = useState(false)
  const [gifState,     setGifState]     = useState(null)

  const canvasRef = useRef(null)
  const etchRef   = useRef(null)

  async function loadById(id) {
    setLoading(true)
    setError(null)
    setGrid(null)
    setNormieId(null)
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

  useEffect(() => {
    if (sharedId === null || sharedId === normieId) return
    setInputId(String(sharedId))
    loadById(sharedId)
  }, [sharedId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas     = canvasRef.current
    const etchCanvas = etchRef.current
    if (!canvas || !etchCanvas) return

    const ctx  = canvas.getContext('2d')
    const eCtx = etchCanvas.getContext('2d')
    const cwOriginal = CW_ORIGINAL
    const cwGhost    = CW_GHOST
    let rafId = null

    if (!grid) {
      ctx.fillStyle = cwOriginal.off
      ctx.fillRect(0, 0, SIZE, SIZE)
      eCtx.clearRect(0, 0, ETCH_W, ETCH_H)
      return
    }

    if (!effectPicked) {
      drawPixels(ctx, grid, cwOriginal)
      return
    }

    // ── Celebration ─────────────────────────────────────────────────
    if (effect === 'celebration') {
      const particles = []

      function frameCelebration() {
        drawPixels(ctx, grid, cwOriginal)
        const count = Math.floor(Math.random() * 3) + 2
        for (let i = 0; i < count; i++) {
          if (Math.random() < 0.8) particles.push(spawnParticle())
        }
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i]
          p.vy += 0.05; p.x += p.vx; p.y += p.vy; p.rotation += p.rotationSpeed
          if (p.y > SIZE * 0.72) {
            p.alpha = Math.max(0, 1 - (p.y - SIZE * 0.72) / (SIZE * 0.28))
          }
          if (p.y > SIZE + 10 || p.alpha <= 0) { particles.splice(i, 1); continue }
          ctx.save()
          ctx.globalAlpha = p.alpha
          ctx.fillStyle   = p.color
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rotation)
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size)
          ctx.restore()
        }
        rafId = requestAnimationFrame(frameCelebration)
      }
      rafId = requestAnimationFrame(frameCelebration)

    // ── Chromatic Rip ───────────────────────────────────────────────
    } else if (effect === 'chromatic-rip') {
      let phase = 'idle', timer = 0
      let idleTarget = Math.floor(Math.random() * 60) + 50
      let rowShifts = {}, rgbOffset = 10, flashAlpha = 0
      let fromCw = cwOriginal, toCw = cwGhost

      function frameGlitch() {
        timer++
        if (phase === 'idle') {
          drawPixels(ctx, grid, fromCw)
          if (timer >= idleTarget) {
            phase = 'scramble'; timer = 0; rowShifts = {}
            const numRows = Math.floor(Math.random() * 7) + 3
            for (let i = 0; i < numRows; i++) {
              const row = Math.floor(Math.random() * GRID)
              rowShifts[row] = (Math.random() < 0.5 ? -1 : 1) * (Math.floor(Math.random() * 6) + 2)
            }
          }
        } else if (phase === 'scramble') {
          for (let y = 0; y < GRID; y++) {
            const shift = rowShifts[y] || 0
            for (let x = 0; x < GRID; x++) {
              const srcX = ((x - shift) % GRID + GRID) % GRID
              ctx.fillStyle = grid[y][srcX] ? fromCw.on : fromCw.off
              ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
            }
          }
          if (timer >= 10) { phase = 'rgb'; timer = 0; rgbOffset = Math.floor(Math.random() * 8) + 8 }
        } else if (phase === 'rgb') {
          ctx.fillStyle = fromCw.off
          ctx.fillRect(0, 0, SIZE, SIZE)
          for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
            if (!grid[y][x]) continue
            ctx.fillStyle = 'rgba(255, 20, 50, 0.95)'
            ctx.fillRect(x * CELL - rgbOffset, y * CELL, CELL, CELL)
          }
          for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
            if (!grid[y][x]) continue
            ctx.fillStyle = 'rgba(20, 80, 255, 0.95)'
            ctx.fillRect(x * CELL + rgbOffset, y * CELL, CELL, CELL)
          }
          if (timer >= 8) { phase = 'flash'; timer = 0; flashAlpha = 0.95 }
        } else if (phase === 'flash') {
          drawPixels(ctx, grid, toCw)
          ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`
          ctx.fillRect(0, 0, SIZE, SIZE)
          flashAlpha -= 0.11
          if (flashAlpha <= 0) {
            const prev = fromCw; fromCw = toCw; toCw = prev
            phase = 'idle'; timer = 0; idleTarget = Math.floor(Math.random() * 60) + 50
          }
        }
        rafId = requestAnimationFrame(frameGlitch)
      }
      rafId = requestAnimationFrame(frameGlitch)

    // ── Etch It ─────────────────────────────────────────────────────
    } else if (effect === 'etch-it') {
      const path = buildEtchPath()

      // Offscreen accumulates drawn pixels — only new pixels added each frame
      const off = document.createElement('canvas')
      off.width = 400; off.height = 400
      const offCtx = off.getContext('2d')
      offCtx.fillStyle = ETCH_SCREEN
      offCtx.fillRect(0, 0, 400, 400)

      let pos = 0, speed = 0.5, targetSpeed = 1.0, speedTimer = 0
      let xDist = 0, yDist = 0, lastIdx = 0, pauseFrames = 0

      function tick() {
        if (pos >= path.length - 1) {
          // Hold the finished drawing, then loop
          pauseFrames++
          drawEtchFrame(eCtx, off, null, path, xDist, yDist)
          if (pauseFrames > 110) {
            pos = 0; speed = 0.5; targetSpeed = 1.0; speedTimer = 0
            xDist = 0; yDist = 0; lastIdx = 0; pauseFrames = 0
            offCtx.fillStyle = ETCH_SCREEN
            offCtx.fillRect(0, 0, 400, 400)
          }
          rafId = requestAnimationFrame(tick)
          return
        }

        // Variable speed — creates the "one dial slows while the other goes" feel.
        // Very slow bursts make it look like careful deliberate turns; fast bursts
        // are confident diagonal sweeps.
        speedTimer++
        if (speedTimer > 15 + Math.floor(Math.random() * 55)) {
          const r = Math.random()
          if      (r < 0.20) targetSpeed = 0.06 + Math.random() * 0.18  // crawl
          else if (r < 0.50) targetSpeed = 0.40 + Math.random() * 0.90  // steady
          else if (r < 0.78) targetSpeed = 1.20 + Math.random() * 2.00  // brisk
          else               targetSpeed = 3.50 + Math.random() * 3.50  // burst
          speedTimer = 0
        }
        speed += (targetSpeed - speed) * 0.05
        pos = Math.min(pos + speed, path.length - 1)
        const idx = Math.floor(pos)

        // Accumulate new pixels onto offscreen canvas
        offCtx.fillStyle = ETCH_DRAWN
        for (let i = lastIdx; i <= idx; i++) {
          const { x, y } = path[i]
          if (grid[y][x]) offCtx.fillRect(x * CELL, y * CELL, CELL, CELL)
          // Track X/Y distances independently — drives dial rotation rates
          if (i > 0) {
            xDist += Math.abs(path[i].x - path[i - 1].x)
            yDist += Math.abs(path[i].y - path[i - 1].y)
          }
        }
        lastIdx = idx + 1

        drawEtchFrame(eCtx, off, idx, path, xDist, yDist)
        rafId = requestAnimationFrame(tick)
      }

      rafId = requestAnimationFrame(tick)
    }

    return () => { if (rafId !== null) cancelAnimationFrame(rafId) }
  }, [grid, effect, effectPicked])

  async function downloadGif() {
    const isEtch = effect === 'etch-it'
    const canvas = isEtch ? etchRef.current : canvasRef.current
    if (!canvas || normieId === null || gifState !== null) return

    const FPS         = 15
    const FRAME_MS    = Math.round(1000 / FPS)
    const DURATION_MS = isEtch ? 5000 : 3000
    const totalFrames = Math.ceil(DURATION_MS / FRAME_MS)
    const OUT_W       = isEtch ? ETCH_W : 600
    const OUT_H       = isEtch ? ETCH_H : 600

    setGifState('recording')
    try {
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width:   OUT_W,
        height:  OUT_H,
        workerScript: '/gif.worker.js',
        repeat: 0,
      })

      await new Promise(resolve => {
        let count = 0
        const interval = setInterval(() => {
          const frame = document.createElement('canvas')
          frame.width = OUT_W; frame.height = OUT_H
          const fCtx = frame.getContext('2d')
          fCtx.imageSmoothingEnabled = false
          fCtx.drawImage(canvas, 0, 0, OUT_W, OUT_H)
          gif.addFrame(frame, { delay: FRAME_MS, copy: true })
          if (++count >= totalFrames) { clearInterval(interval); resolve() }
        }, FRAME_MS)
      })

      setGifState('encoding')
      await new Promise((resolve, reject) => {
        gif.on('finished', async blob => {
          const label = EFFECTS.find(e => e.id === effect)?.label.toLowerCase().replace(/\s+/g, '-') ?? effect
          await shareOrDownload(blob, `normie-${normieId}-${label}.gif`)
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

  const showEtch = effect === 'etch-it' && effectPicked

  return (
    <div className="gifs-page">
      <header className="header">
        <h1 className="title">Gifs</h1>
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

      <div className="gifs-effect-label">
        {grid && !effectPicked
          ? 'SELECT AN EFFECT BELOW'
          : effectPicked
          ? EFFECTS.find(e => e.id === effect)?.label.toUpperCase()
          : ''}
      </div>

      <div className="gifs-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className="gifs-canvas"
          style={showEtch ? { display: 'none' } : undefined}
        />
        <canvas
          ref={etchRef}
          width={ETCH_W}
          height={ETCH_H}
          className="gifs-canvas"
          style={showEtch ? undefined : { display: 'none' }}
        />
      </div>

      {grid && (
        <div className="effects-panel gifs-panel">
          <span className="effects-label">Effect</span>
          <div className="effects-row">
            {EFFECTS.map(ef => (
              <button
                key={ef.id}
                className={`effect-btn${effect === ef.id ? ' active' : ''}`}
                onClick={() => { setEffect(ef.id); setEffectPicked(true) }}
              >
                {ef.label}
              </button>
            ))}
          </div>
          <button
            className="download-btn"
            onClick={downloadGif}
            disabled={normieId === null || gifState !== null}
          >
            {gifState === 'recording' ? 'Recording…' : gifState === 'encoding' ? 'Encoding…' : 'Download GIF'}
          </button>
        </div>
      )}
    </div>
  )
}
