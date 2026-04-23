import { useState, useEffect, useRef } from 'react'
import GIF from 'gif.js'
import { shareOrDownload } from './share'
import './AnimatePage.css'

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

const ANIM_NAMES = ['STATIC', 'GLITCH', 'BREATHE', 'RAIN', 'SCANLINE', 'DISINTEGRATE']

// 1=hand(gray)  2=outline(near-black)  3=highlight(near-white)  4=sleeve
const HAND_COLORS = {
  1: '#c0c0c0',
  2: '#333333',
  3: '#e8e8e8',
  4: '#222222',
}

const HAND_WIDTH  = 10
const HAND_HEIGHT = 18
const HAND_X_COL  = GRID - HAND_WIDTH - 6   // col 24 — 6 left of right edge
const HAND_Y_BASE = GRID - HAND_HEIGHT + 2  // row 24 — 2 cells below fully visible

//              0  1  2  3  4  5  6  7  8  9
const HAND_SHAPE = [
  [0, 0, 0, 2, 2, 2, 0, 0, 0, 0],  //  0 fingertip (1-cell wide cap)
  [0, 0, 0, 2, 3, 2, 0, 0, 0, 0],  //  1 nail
  [0, 0, 0, 2, 3, 2, 0, 0, 0, 0],  //  2 nail
  [0, 0, 0, 2, 1, 2, 0, 0, 0, 0],  //  3 finger
  [0, 0, 0, 2, 1, 2, 0, 0, 0, 0],  //  4 finger
  [0, 0, 2, 1, 1, 1, 2, 0, 0, 0],  //  5 knuckle widens (right shifted in 1)
  [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],  //  6 fist top
  [2, 3, 1, 1, 1, 1, 1, 1, 2, 0],  //  7 thumb nub — outline steps left, highlight inside
  [2, 3, 1, 1, 1, 1, 1, 1, 2, 0],  //  8 thumb nub
  [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],  //  9 fist (thumb over)
  [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],  // 10 fist bottom
  [0, 0, 2, 1, 1, 1, 2, 0, 0, 0],  // 11 wrist — right shifted in 1
  [0, 0, 2, 1, 1, 1, 2, 0, 0, 0],  // 12 wrist
  [0, 0, 4, 4, 4, 4, 4, 0, 0, 0],  // 13 sleeve at wrist width
  [0, 4, 4, 4, 4, 4, 4, 4, 4, 0],  // 14 sleeve flares
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 0],  // 15 sleeve full
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 0],  // 16
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 0],  // 17 (no closing bottom)
]

// yOffsetCells: 0 = base (2 rows clipped), -2 = fully visible
const HAND_STEPS   = [0, -1, -2, -1]
const HAND_STEP_MS = 380

function drawHandOverlay(canvas, yOffsetCells) {
  const ctx  = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const baseX = HAND_X_COL * CELL
  const baseY = (HAND_Y_BASE + yOffsetCells) * CELL
  for (let row = 0; row < HAND_SHAPE.length; row++) {
    const py = baseY + row * CELL
    if (py >= SIZE) continue
    for (let col = 0; col < HAND_SHAPE[row].length; col++) {
      const v = HAND_SHAPE[row][col]
      if (!v) continue
      ctx.fillStyle = HAND_COLORS[v]
      ctx.fillRect(baseX + col * CELL, py, CELL, CELL)
    }
  }
}

function rand(min, max) {
  return Math.random() * (max - min) + min
}

function hexRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

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

export default function AnimatePage({ sharedId = null, onIdLoad } = {}) {
  const [inputId,   setInputId]   = useState('')
  const [normieId,  setNormieId]  = useState(null)
  const [grid,      setGrid]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [animation, setAnimation] = useState('STATIC')
  const [colorway,  setColorway]  = useState('original')
  const [gifState,  setGifState]  = useState(null) // null | 'recording' | 'encoding'
  const [showHand,  setShowHand]  = useState(false)

  const canvasRef  = useRef(null)
  const overlayRef = useRef(null)

  async function loadById(id) {
    setLoading(true)
    setError(null)
    setGrid(null)
    setNormieId(null)
    setAnimation('STATIC')
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

  // Animate the hand overlay — bobs up 2 cells then back down
  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    if (!showHand) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    let step         = 0
    let lastStepTime = null
    let rafId
    function tick(now) {
      if (!lastStepTime) lastStepTime = now
      if (now - lastStepTime >= HAND_STEP_MS) {
        step         = (step + 1) % HAND_STEPS.length
        lastStepTime = now
      }
      drawHandOverlay(canvas, HAND_STEPS[step])
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [showHand])

  async function downloadGif() {
    const canvas = canvasRef.current
    if (!canvas || normieId === null || gifState !== null) return

    const FPS        = 15
    const FRAME_MS   = Math.round(1000 / FPS)
    const DURATIONS  = {
      STATIC:       1000,
      GLITCH:       3000,
      BREATHE:      3000,
      RAIN:         4500,
      SCANLINE:     3600,
      DISINTEGRATE: 3500,
    }
    const duration    = DURATIONS[animation] ?? 3000
    const totalFrames = Math.max(2, Math.ceil(duration / FRAME_MS))
    const OUT         = 600

    setGifState('recording')
    try {
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width:   OUT,
        height:  OUT,
        workerScript: '/gif.worker.js',
        repeat: 0,
      })

      // Capture live frames from the running animation canvas
      await new Promise(resolve => {
        let count = 0
        const interval = setInterval(() => {
          const frame = document.createElement('canvas')
          frame.width  = OUT
          frame.height = OUT
          const fCtx = frame.getContext('2d')
          fCtx.imageSmoothingEnabled = false
          fCtx.drawImage(canvas, 0, 0, OUT, OUT)
          if (showHand && overlayRef.current) fCtx.drawImage(overlayRef.current, 0, 0, OUT, OUT)
          gif.addFrame(frame, { delay: FRAME_MS, copy: true })
          if (++count >= totalFrames) { clearInterval(interval); resolve() }
        }, FRAME_MS)
      })

      setGifState('encoding')
      await new Promise((resolve, reject) => {
        gif.on('finished', async blob => {
          await shareOrDownload(blob, `normie-${normieId}-${animation.toLowerCase()}.gif`)
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

  // Animation loop — re-runs whenever grid, animation, or colorway changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const cw  = COLORWAYS.find(c => c.id === colorway)
    let rafId = null

    // No grid yet → blank canvas
    if (!grid) {
      ctx.fillStyle = cw.off
      ctx.fillRect(0, 0, SIZE, SIZE)
      return
    }

    // ── STATIC ────────────────────────────────────────────────
    if (animation === 'STATIC') {
      drawPixels(ctx, grid, cw)
      return
    }

    // ── GLITCH ────────────────────────────────────────────────
    if (animation === 'GLITCH') {
      let nextGlitchAt = performance.now() + rand(200, 400)
      let glitchEndAt  = null
      let glitchedRows = []
      let overlayAlpha = 0

      function frameGlitch(now) {
        drawPixels(ctx, grid, cw)

        if (glitchEndAt !== null) {
          for (const { row, shift } of glitchedRows) {
            const py = row * CELL
            ctx.fillStyle = cw.off
            ctx.fillRect(0, py, SIZE, CELL)
            for (let x = 0; x < GRID; x++) {
              ctx.fillStyle = grid[row][x] ? cw.on : cw.off
              ctx.fillRect(x * CELL + shift, py, CELL, CELL)
            }
          }
          if (overlayAlpha > 0) {
            ctx.fillStyle = `rgba(255,255,255,${overlayAlpha})`
            ctx.fillRect(0, 0, SIZE, SIZE)
          }
          if (now >= glitchEndAt) {
            glitchEndAt  = null
            glitchedRows = []
            overlayAlpha = 0
            nextGlitchAt = now + rand(200, 400)
          }
        } else if (now >= nextGlitchAt) {
          const numRows = Math.floor(rand(2, 5))
          glitchedRows  = Array.from({ length: numRows }, () => ({
            row:   Math.floor(Math.random() * GRID),
            shift: Math.round(rand(-8, 8)),
          }))
          overlayAlpha = Math.random() < 0.3 ? rand(0.05, 0.2) : 0
          glitchEndAt  = now + rand(50, 150)
        }

        rafId = requestAnimationFrame(frameGlitch)
      }
      rafId = requestAnimationFrame(frameGlitch)

    // ── BREATHE ───────────────────────────────────────────────
    } else if (animation === 'BREATHE') {
      const startTime = performance.now()
      const CYCLE     = 3000

      function frameBreathe(now) {
        const t     = (now - startTime) / CYCLE
        const scale = 0.97 + 0.03 * Math.sin(t * Math.PI * 2)
        const alpha = 0.85 + 0.15 * Math.sin(t * Math.PI * 2)

        ctx.fillStyle = cw.off
        ctx.fillRect(0, 0, SIZE, SIZE)
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(SIZE / 2, SIZE / 2)
        ctx.scale(scale, scale)
        ctx.translate(-SIZE / 2, -SIZE / 2)
        drawPixels(ctx, grid, cw)
        ctx.restore()

        rafId = requestAnimationFrame(frameBreathe)
      }
      rafId = requestAnimationFrame(frameBreathe)

    // ── RAIN ──────────────────────────────────────────────────
    } else if (animation === 'RAIN') {
      const pixels = []
      for (let row = 0; row < GRID; row++)
        for (let col = 0; col < GRID; col++)
          pixels.push({
            col, row,
            on:           grid[row][col],
            homeY:        row * CELL,
            curY:         row * CELL,
            state:        'waiting',
            delay:        rand(0, 800),
            speed:        rand(3, 8),
            fallStart:    null,
            riseStart:    null,
            riseDuration: rand(400, 700),
          })

      const IDLE_MS = 800
      let cycleStart     = performance.now()
      let allOffTriggered = false

      function resetCycle(now) {
        cycleStart      = now
        allOffTriggered = false
        for (const p of pixels) {
          p.state        = 'waiting'
          p.curY         = p.homeY
          p.delay        = rand(0, 800)
          p.speed        = rand(3, 8)
          p.fallStart    = null
          p.riseStart    = null
          p.riseDuration = rand(400, 700)
        }
      }

      function frameRain(now) {
        ctx.fillStyle = cw.off
        ctx.fillRect(0, 0, SIZE, SIZE)

        const elapsed = now - cycleStart

        if (elapsed < IDLE_MS) {
          drawPixels(ctx, grid, cw)
        } else {
          const fallElapsed = elapsed - IDLE_MS

          // Transition waiting → falling
          for (const p of pixels) {
            if (p.state === 'waiting' && fallElapsed >= p.delay) {
              p.state     = 'falling'
              p.fallStart = now - (fallElapsed - p.delay)
            }
            if (p.state === 'falling') {
              const fe = now - p.fallStart
              p.curY   = p.homeY + (fe / 16) * p.speed
              if (p.curY >= SIZE + CELL) p.state = 'offscreen'
            }
          }

          // All offscreen → start rising
          if (!allOffTriggered && pixels.every(p => p.state === 'offscreen')) {
            allOffTriggered = true
            for (const p of pixels) {
              p.state        = 'rising'
              p.curY         = SIZE + CELL
              p.riseStart    = now + rand(0, 500)
              p.riseDuration = rand(400, 700)
            }
          }

          // Update rising pixels
          if (allOffTriggered) {
            for (const p of pixels) {
              if (p.state === 'rising' && now >= p.riseStart) {
                const re    = now - p.riseStart
                const t     = Math.min(1, re / p.riseDuration)
                const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
                p.curY      = (SIZE + CELL) + (p.homeY - (SIZE + CELL)) * eased
                if (t >= 1) { p.state = 'done'; p.curY = p.homeY }
              }
            }
          }

          // Draw all visible pixels
          for (const p of pixels) {
            if (p.state === 'offscreen')                     continue
            if (p.state === 'rising' && p.curY >= SIZE)     continue
            if (p.curY + CELL < 0)                          continue
            ctx.fillStyle = p.on ? cw.on : cw.off
            ctx.fillRect(p.col * CELL, p.curY, CELL, CELL)
          }

          if (allOffTriggered && pixels.every(p => p.state === 'done')) resetCycle(now)
        }

        rafId = requestAnimationFrame(frameRain)
      }
      rafId = requestAnimationFrame(frameRain)

    // ── SCANLINE ──────────────────────────────────────────────
    } else if (animation === 'SCANLINE') {
      let phase      = 'scanning'
      let phaseStart = performance.now()
      const SCAN_MS  = 2000
      const PAUSE_MS = 1000
      const FADE_MS  = 600

      function frameScanline(now) {
        const elapsed = now - phaseStart

        if (phase === 'scanning') {
          const t            = Math.min(1, elapsed / SCAN_MS)
          const revealedRows = Math.floor(t * GRID)
          const scanY        = Math.floor(t * SIZE)

          ctx.fillStyle = cw.off
          ctx.fillRect(0, 0, SIZE, SIZE)

          for (let row = 0; row < revealedRows; row++)
            for (let x = 0; x < GRID; x++) {
              ctx.fillStyle = grid[row][x] ? cw.on : cw.off
              ctx.fillRect(x * CELL, row * CELL, CELL, CELL)
            }

          if (t < 1) {
            ctx.fillStyle = 'rgba(255,255,255,0.6)'
            ctx.fillRect(0, scanY, SIZE, 2)
          }

          if (t >= 1) { phase = 'pausing'; phaseStart = now }

        } else if (phase === 'pausing') {
          drawPixels(ctx, grid, cw)
          if (elapsed >= PAUSE_MS) { phase = 'fading'; phaseStart = now }

        } else if (phase === 'fading') {
          const t = Math.min(1, elapsed / FADE_MS)
          drawPixels(ctx, grid, cw)
          const [r, g, b] = hexRgb(cw.off)
          ctx.fillStyle = `rgba(${r},${g},${b},${t})`
          ctx.fillRect(0, 0, SIZE, SIZE)
          if (t >= 1) { phase = 'scanning'; phaseStart = now }
        }

        rafId = requestAnimationFrame(frameScanline)
      }
      rafId = requestAnimationFrame(frameScanline)

    // ── DISINTEGRATE ──────────────────────────────────────────
    } else if (animation === 'DISINTEGRATE') {
      const pixels = []
      for (let row = 0; row < GRID; row++)
        for (let col = 0; col < GRID; col++)
          pixels.push({
            col, row,
            on:      grid[row][col],
            homeX:   col * CELL,
            homeY:   row * CELL,
            targetX: 0,
            targetY: 0,
          })

      function genTargets() {
        for (const p of pixels) {
          p.targetX = rand(0, SIZE - CELL)
          p.targetY = rand(0, SIZE - CELL)
        }
      }
      genTargets()

      const TIMINGS = { idle: 500, exploding: 800, exploded: 500, reassembling: 1000, assembled: 600 }
      const easeIn  = t => t * t * t
      const easeOut = t => 1 - Math.pow(1 - t, 3)

      let phase      = 'idle'
      let phaseStart = performance.now()

      function frameDisintegrate(now) {
        ctx.fillStyle = cw.off
        ctx.fillRect(0, 0, SIZE, SIZE)

        const elapsed = now - phaseStart
        const dur     = TIMINGS[phase]
        const t       = Math.min(1, elapsed / dur)

        if (phase === 'idle') {
          drawPixels(ctx, grid, cw)
          if (elapsed >= dur) { genTargets(); phase = 'exploding'; phaseStart = now }

        } else if (phase === 'exploding') {
          const prog = easeIn(t)
          for (const p of pixels) {
            ctx.fillStyle = p.on ? cw.on : cw.off
            ctx.fillRect(
              p.homeX + (p.targetX - p.homeX) * prog,
              p.homeY + (p.targetY - p.homeY) * prog,
              CELL, CELL
            )
          }
          if (t >= 1) { phase = 'exploded'; phaseStart = now }

        } else if (phase === 'exploded') {
          for (const p of pixels) {
            ctx.fillStyle = p.on ? cw.on : cw.off
            ctx.fillRect(p.targetX, p.targetY, CELL, CELL)
          }
          if (elapsed >= dur) { phase = 'reassembling'; phaseStart = now }

        } else if (phase === 'reassembling') {
          const prog = easeOut(t)
          for (const p of pixels) {
            ctx.fillStyle = p.on ? cw.on : cw.off
            ctx.fillRect(
              p.targetX + (p.homeX - p.targetX) * prog,
              p.targetY + (p.homeY - p.targetY) * prog,
              CELL, CELL
            )
          }
          if (t >= 1) { phase = 'assembled'; phaseStart = now }

        } else if (phase === 'assembled') {
          drawPixels(ctx, grid, cw)
          if (elapsed >= dur) { phase = 'idle'; phaseStart = now }
        }

        rafId = requestAnimationFrame(frameDisintegrate)
      }
      rafId = requestAnimationFrame(frameDisintegrate)
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [grid, animation, colorway])

  return (
    <div className="animate-page">
      <header className="header">
        <h1 className="title">Animate</h1>
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

      <div className="animate-canvas-wrap">
        <canvas ref={canvasRef} width={SIZE} height={SIZE} className="animate-canvas" />
        <canvas ref={overlayRef} width={SIZE} height={SIZE} className="hand-overlay-canvas" />
      </div>

      <div className="anim-selector">
        {ANIM_NAMES.map(name => (
          <button
            key={name}
            className={`anim-btn${animation === name ? ' active' : ''}`}
            onClick={() => setAnimation(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {grid && (
        <div className="effects-panel animate-panel">
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
          <div className="effects-row" style={{ marginTop: 8 }}>
            <button
              className={`effect-btn${showHand ? ' active' : ''}`}
              onClick={() => setShowHand(v => !v)}
            >
              BIRD
            </button>
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
