import { useState, useEffect, useRef } from 'react'
import './SlotPage.css'

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

const SCALE = 8
const ROWS  = 40
const COLS  = 40

// Three vertical thirds of the 40-column normie
const SLOT_RANGES = [
  { start: 0,  end: 13 },
  { start: 13, end: 26 },
  { start: 26, end: 40 },
]

const LOCK_TIMES  = [2200, 3700, 5300]  // ms when each slot locks
const SPIN_SPEEDS = [220,  300,  160]   // canvas px per second

function parsePixels(raw) {
  const str = raw.trim().slice(0, 1600)
  const grid = []
  for (let y = 0; y < ROWS; y++) {
    const row = []
    for (let x = 0; x < COLS; x++) row.push(str[y * COLS + x] === '1')
    grid.push(row)
  }
  return grid
}

function drawSlice(ctx, grid, range, cw, scrollY, pixelated) {
  const { start, end } = range
  const sliceW  = end - start
  const canvasW = sliceW * SCALE
  const canvasH = ROWS   * SCALE

  ctx.clearRect(0, 0, canvasW, canvasH)

  if (pixelated) {
    // 4-pixel block groups — obfuscates without hiding completely
    const block   = 4
    const blockPx = block * SCALE
    for (let by = 0; by < Math.ceil(ROWS / block); by++) {
      for (let bx = 0; bx < Math.ceil(sliceW / block); bx++) {
        const py = Math.min(by * block, ROWS - 1)
        const px = Math.min(start + bx * block, COLS - 1)
        ctx.fillStyle = grid[py][px] ? cw.on : cw.off
        ctx.fillRect(bx * blockPx, by * blockPx, blockPx, blockPx)
      }
    }
    return
  }

  // Downward tiling scroll — new content appears from top
  const offset = ((scrollY % canvasH) + canvasH) % canvasH

  for (let tile = -1; tile <= 1; tile++) {
    const baseY = tile * canvasH + offset
    if (baseY >= canvasH || baseY + canvasH <= 0) continue
    for (let y = 0; y < ROWS; y++) {
      const ry = baseY + y * SCALE
      if (ry + SCALE <= 0 || ry >= canvasH) continue
      for (let x = start; x < end; x++) {
        ctx.fillStyle = grid[y][x] ? cw.on : cw.off
        ctx.fillRect((x - start) * SCALE, ry, SCALE, SCALE)
      }
    }
  }
}

export default function SlotPage({ sharedId }) {
  const [inputs,        setInputs]        = useState(['', '', ''])
  const [phase,         setPhase]         = useState('idle')
  const [lockedSlots,   setLockedSlots]   = useState([false, false, false])
  const [bouncingSlots, setBouncingSlots] = useState([false, false, false])
  const [flashingSlots, setFlashingSlots] = useState([false, false, false])
  const [colorway,      setColorway]      = useState(COLORWAYS[0])
  const [resolvedIds,   setResolvedIds]   = useState([null, null, null])
  const [previewGrids,  setPreviewGrids]  = useState([null, null, null])
  const [previewIds,    setPreviewIds]    = useState([null, null, null])
  const [error,         setError]         = useState('')

  const canvasRefs = [useRef(null), useRef(null), useRef(null)]
  const rafRef     = useRef(null)

  // Mutable state shared with RAF callback — avoids stale closures
  const st = useRef({
    normies:       [null, null, null],
    scrollOffsets: [0, 0, 0],
    locked:        [false, false, false],
    startTime:     null,
    colorway:      COLORWAYS[0],
  })

  useEffect(() => { st.current.colorway = colorway }, [colorway])

  // Pre-fill left slot from sharedId
  useEffect(() => {
    if (sharedId !== null && sharedId !== undefined) {
      setInputs(prev => { const n = [...prev]; n[0] = String(sharedId); return n })
    }
  }, [sharedId])

  // Debounce-fetch previews when IDs are typed in idle state
  useEffect(() => {
    if (phase !== 'idle') return
    const timers = inputs.map((inp, i) => {
      const n = parseInt(inp.trim(), 10)
      const valid = !isNaN(n) && n >= 0 && n <= 9999
      if (!valid) {
        setPreviewGrids(prev => { const p = [...prev]; p[i] = null; return p })
        setPreviewIds(prev  => { const p = [...prev]; p[i] = null; return p })
        return null
      }
      return setTimeout(async () => {
        try {
          const res = await fetch(`${API_BASE}/normie/${n}/pixels`)
          if (!res.ok) return
          const grid = parsePixels(await res.text())
          setPreviewGrids(prev => { const p = [...prev]; p[i] = grid; return p })
          setPreviewIds(prev  => { const p = [...prev]; p[i] = n;    return p })
        } catch {}
      }, 450)
    })
    return () => timers.forEach(t => t && clearTimeout(t))
  }, [inputs, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Draw previews on canvas when in idle state
  useEffect(() => {
    if (phase !== 'idle') return
    for (let i = 0; i < 3; i++) {
      const canvas = canvasRefs[i].current
      if (!canvas) continue
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (previewGrids[i]) {
        ctx.save()
        ctx.globalAlpha = 0.5
        drawSlice(ctx, previewGrids[i], SLOT_RANGES[i], colorway, 0, false)
        ctx.restore()
      }
    }
  }, [previewGrids, colorway, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw when colorway changes in static phases
  useEffect(() => {
    if (phase !== 'done') return
    for (let i = 0; i < 3; i++) {
      const canvas = canvasRefs[i].current
      const grid   = st.current.normies[i]
      if (!canvas || !grid) continue
      drawSlice(canvas.getContext('2d'), grid, SLOT_RANGES[i], colorway, 0, false)
    }
  }, [colorway, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Spinning RAF loop
  useEffect(() => {
    if (phase !== 'spinning') return

    function triggerLock(i) {
      st.current.locked[i] = true
      setLockedSlots(prev  => { const n = [...prev]; n[i] = true;  return n })
      setFlashingSlots(prev => { const n = [...prev]; n[i] = true; return n })
      setBouncingSlots(prev => { const n = [...prev]; n[i] = true; return n })
      setTimeout(() => {
        setBouncingSlots(prev => { const n = [...prev]; n[i] = false; return n })
      }, 600)
    }

    let last = null

    function animate(ts) {
      if (!last) last = ts
      const delta = Math.min(ts - last, 50)
      last = ts

      if (!st.current.startTime) st.current.startTime = ts
      const elapsed = ts - st.current.startTime

      for (let i = 0; i < 3; i++) {
        if (st.current.locked[i]) continue

        if (elapsed >= LOCK_TIMES[i]) {
          triggerLock(i)
          const canvas = canvasRefs[i].current
          if (canvas && st.current.normies[i]) {
            drawSlice(canvas.getContext('2d'), st.current.normies[i], SLOT_RANGES[i], st.current.colorway, 0, false)
          }
        } else {
          st.current.scrollOffsets[i] += SPIN_SPEEDS[i] * (delta / 1000)
          const canvas = canvasRefs[i].current
          if (canvas && st.current.normies[i]) {
            drawSlice(canvas.getContext('2d'), st.current.normies[i], SLOT_RANGES[i], st.current.colorway, st.current.scrollOffsets[i], false)
          }
        }
      }

      if (st.current.locked.every(Boolean)) {
        setPhase('done')
      } else {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRoll() {
    if (['loading', 'spinning', 'teasing'].includes(phase)) return
    setError('')
    setPhase('loading')
    setLockedSlots([false, false, false])
    setBouncingSlots([false, false, false])
    setFlashingSlots([false, false, false])
    st.current.locked        = [false, false, false]
    st.current.scrollOffsets = [0, 0, 0]
    st.current.startTime     = null

    try {
      const ids = inputs.map(inp => {
        const n = parseInt(inp.trim(), 10)
        return !isNaN(n) && n >= 0 && n <= 9999 ? n : Math.floor(Math.random() * 10000)
      })
      setResolvedIds(ids)

      const normies = await Promise.all(
        ids.map((id, i) => {
          if (previewIds[i] === id && previewGrids[i]) return Promise.resolve(previewGrids[i])
          return fetch(`${API_BASE}/normie/${id}/pixels`)
            .then(r => { if (!r.ok) throw new Error(`#${id} not found`); return r.text() })
            .then(parsePixels)
        })
      )
      st.current.normies = normies
      st.current.startTime = null
      setPhase('spinning')
    } catch (e) {
      setError(e.message)
      setPhase('idle')
    }
  }

  function handleReset() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    st.current.normies       = [null, null, null]
    st.current.locked        = [false, false, false]
    st.current.scrollOffsets = [0, 0, 0]
    st.current.startTime     = null
    setPhase('idle')
    setLockedSlots([false, false, false])
    setBouncingSlots([false, false, false])
    setFlashingSlots([false, false, false])
    setResolvedIds([null, null, null])
    setPreviewGrids([null, null, null])
    setPreviewIds([null, null, null])
    setError('')
    for (const ref of canvasRefs) {
      const c = ref.current
      if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height)
    }
  }

  function handleDownload() {
    const { normies, colorway: cw } = st.current
    if (!normies.every(Boolean)) return
    const DL  = 30  // 40 * 30 = 1200px output
    const off = document.createElement('canvas')
    off.width  = COLS * DL
    off.height = ROWS * DL
    const ctx  = off.getContext('2d')
    for (let i = 0; i < 3; i++) {
      const { start, end } = SLOT_RANGES[i]
      for (let y = 0; y < ROWS; y++)
        for (let x = start; x < end; x++) {
          ctx.fillStyle = normies[i][y][x] ? cw.on : cw.off
          ctx.fillRect(x * DL, y * DL, DL, DL)
        }
    }
    off.toBlob(blob => {
      const a = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = `normie-slots-${resolvedIds.join('-')}-${cw.id}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    }, 'image/png')
  }

  const busy   = ['loading', 'spinning'].includes(phase)
  const isDone = phase === 'done'

  return (
    <div className="slot-page">
      <header className="header">
        <h1 className="title">Normie Slots</h1>
        <p className="subtitle">Blank slots pull random normies</p>
      </header>

      <div className="slot-inputs">
        {['LEFT', 'MID', 'RIGHT'].map((label, i) => (
          <div key={i} className="slot-input-group">
            <span className="slot-input-label">{label}</span>
            <input
              type="number"
              min="0"
              max="9999"
              placeholder="random"
              value={inputs[i]}
              onChange={e => { const n = [...inputs]; n[i] = e.target.value; setInputs(n) }}
              disabled={busy}
              className="slot-id-input"
            />
          </div>
        ))}
      </div>

      <div className="slot-machine">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={[
              'slot-reel',
              lockedSlots[i]   ? 'reel-locked'  : '',
              bouncingSlots[i] ? 'reel-bounce'  : '',
              phase === 'idle' && !previewGrids[i] ? 'reel-idle' : '',
            ].filter(Boolean).join(' ')}
          >
            <canvas
              ref={canvasRefs[i]}
              width={(SLOT_RANGES[i].end - SLOT_RANGES[i].start) * SCALE}
              height={ROWS * SCALE}
              className="slot-canvas"
              style={{ background: colorway.off }}
            />
            {flashingSlots[i] && <div className="reel-flash" />}
            {lockedSlots[i] && resolvedIds[i] !== null && (
              <div className="reel-id-tag">#{resolvedIds[i]}</div>
            )}
          </div>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="slot-actions">
        {isDone ? (
          <>
            <button className="load-btn" onClick={handleReset}>Reset</button>
            <button className="load-btn" onClick={handleDownload}>Download PNG</button>
          </>
        ) : (
          <button className="slot-roll-btn" onClick={handleRoll} disabled={busy}>
            {phase === 'loading' ? 'Loading…' : busy ? 'Rolling…' : 'Roll'}
          </button>
        )}
      </div>

      <div className="effects-panel" style={{ maxWidth: 380, width: '100%' }}>
        <span className="effects-label">Colorway</span>
        <div className="effects-row">
          {COLORWAYS.map(cw => (
            <button
              key={cw.id}
              className={`effect-btn${colorway.id === cw.id ? ' active' : ''}`}
              onClick={() => setColorway(cw)}
            >
              {cw.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
