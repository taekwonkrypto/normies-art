import { useState, useEffect, useRef } from 'react'
import GIF from 'gif.js'
import { shareOrDownload } from './share'
import './GifsPage.css'

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

const GOLD_COLORS = ['#FFD700', '#FFC200', '#FFCC00', '#F0A500', '#E8C000', '#FFB300', '#FFCA28']

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

export default function GifsPage({ sharedId = null, onIdLoad } = {}) {
  const [inputId,  setInputId]  = useState('')
  const [normieId, setNormieId] = useState(null)
  const [grid,     setGrid]     = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [colorway, setColorway] = useState('original')
  const [gifState, setGifState] = useState(null)

  const canvasRef = useRef(null)

  async function loadById(id) {
    setLoading(true)
    setError(null)
    setGrid(null)
    setNormieId(null)
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

  useEffect(() => {
    if (sharedId === null || sharedId === normieId) return
    setInputId(String(sharedId))
    loadById(sharedId)
  }, [sharedId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const cw = COLORWAYS.find(c => c.id === colorway)
    let rafId = null

    if (!grid) {
      ctx.fillStyle = cw.off
      ctx.fillRect(0, 0, SIZE, SIZE)
      return
    }

    const particles = []

    function frameCelebration() {
      drawPixels(ctx, grid, cw)

      // Spawn 2-4 particles per frame
      const count = Math.floor(Math.random() * 3) + 2
      for (let i = 0; i < count; i++) {
        if (Math.random() < 0.8) particles.push(spawnParticle())
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.vy += 0.05
        p.x  += p.vx
        p.y  += p.vy
        p.rotation += p.rotationSpeed

        if (p.y > SIZE * 0.72) {
          p.alpha = Math.max(0, 1 - (p.y - SIZE * 0.72) / (SIZE * 0.28))
        }

        if (p.y > SIZE + 10 || p.alpha <= 0) {
          particles.splice(i, 1)
          continue
        }

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
    return () => { if (rafId !== null) cancelAnimationFrame(rafId) }
  }, [grid, colorway])

  async function downloadGif() {
    const canvas = canvasRef.current
    if (!canvas || normieId === null || gifState !== null) return

    const FPS         = 15
    const FRAME_MS    = Math.round(1000 / FPS)
    const DURATION_MS = 3000
    const totalFrames = Math.ceil(DURATION_MS / FRAME_MS)
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

      await new Promise(resolve => {
        let count = 0
        const interval = setInterval(() => {
          const frame = document.createElement('canvas')
          frame.width  = OUT
          frame.height = OUT
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
          await shareOrDownload(blob, `normie-${normieId}-celebration.gif`)
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

      <div className="gifs-effect-label">CELEBRATION</div>

      <div className="gifs-canvas-wrap">
        <canvas ref={canvasRef} width={SIZE} height={SIZE} className="gifs-canvas" />
      </div>

      {grid && (
        <div className="effects-panel gifs-panel">
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
