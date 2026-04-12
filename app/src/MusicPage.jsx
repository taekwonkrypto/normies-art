import { useState, useEffect, useRef } from 'react'
import './MusicPage.css'

const API_BASE = 'https://api.normies.art'
const GRID = 40

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

// Pentatonic semitone offsets from C: C D E G A
const PENTA = [0, 2, 4, 7, 9]

// 40 frequencies — 8 octaves × 5 notes, index 0 = lowest (C1), index 39 = highest (A8)
function buildNoteFreqs(octaveShift = 0) {
  const freqs = []
  for (let oct = 1; oct <= 8; oct++) {
    for (const semi of PENTA) {
      // C1 = MIDI 24 = 12*(1+1)+0
      const midi = 12 * (oct + 1 + octaveShift) + semi
      freqs.push(440 * Math.pow(2, (midi - 69) / 12))
    }
  }
  return freqs
}

function parseGrid(str) {
  const g = []
  for (let r = 0; r < GRID; r++) {
    const row = []
    for (let c = 0; c < GRID; c++) row.push(str[r * GRID + c] === '1')
    g.push(row)
  }
  return g
}

function getAudioParams(traits) {
  const map = {}
  if (Array.isArray(traits)) {
    traits.forEach(t => {
      map[(t.trait_type || '').toLowerCase()] = (t.value || '').toLowerCase()
    })
  } else {
    Object.entries(traits).forEach(([k, v]) => {
      map[k.toLowerCase()] = String(v).toLowerCase()
    })
  }

  const type = map['type'] || ''
  let waveform = 'sine'
  if (type.includes('cat'))   waveform = 'triangle'
  else if (type.includes('alien')) waveform = 'sawtooth'
  else if (type.includes('agent')) waveform = 'square'

  const expr = map['expression'] || ''
  let bpm = 120
  if      (expr.includes('slight smile')) bpm = 140
  else if (expr.includes('big smile'))   bpm = 160
  else if (expr.includes('serious'))     bpm = 90
  else if (expr.includes('sad'))         bpm = 70
  else if (expr.includes('angry'))       bpm = 180
  else if (expr.includes('surprised'))   bpm = 150

  const age = map['age'] || ''
  let octaveShift = 0
  if      (age.includes('young')) octaveShift = 1
  else if (age.includes('old'))   octaveShift = -1

  const acc  = map['accessory'] || ''
  const hasReverb = acc.includes('hat') || acc.includes('cap') ||
    acc.includes('beanie') || acc.includes('crown') || acc.includes('top hat')

  const eyes = map['eyes'] || ''
  const hasDetune = eyes.includes('shade') || eyes.includes('sunglass')

  return { waveform, bpm, octaveShift, hasReverb, hasDetune }
}

function createImpulse(ctx) {
  const len = Math.floor(ctx.sampleRate * 1.5)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    }
  }
  return buf
}

function makeNoteGain(ctx, t0, dur) {
  const g = ctx.createGain()
  const att = 0.01, dec = 0.1, sus = 0.6, rel = 0.2, pk = 0.06
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(pk,      t0 + att)
  g.gain.linearRampToValueAtTime(pk * sus, t0 + att + dec)
  g.gain.setValueAtTime(pk * sus, t0 + dur)
  g.gain.linearRampToValueAtTime(0,       t0 + dur + rel)
  return g
}

function buildOscGain(ctx, freq, t0, dur, waveform, detuneCents) {
  const osc = ctx.createOscillator()
  osc.type = waveform
  osc.frequency.value = freq
  if (detuneCents) osc.detune.value = detuneCents
  osc.start(t0)
  osc.stop(t0 + dur + 0.4)
  const gain = makeNoteGain(ctx, t0, dur)
  osc.connect(gain)
  return gain
}

const DRUM_LABELS = ['KICK', 'SNARE', 'HH', 'OPEN']

function synthKick(ctx, t0, dest) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(120, t0)
  osc.frequency.exponentialRampToValueAtTime(0.001, t0 + 0.45)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(1.0, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45)
  osc.connect(gain); gain.connect(dest)
  osc.start(t0); osc.stop(t0 + 0.5)
}

function synthSnare(ctx, t0, dest) {
  const dur = 0.18
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource()
  noise.buffer = buf
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.7, t0); ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  noise.connect(ng); ng.connect(dest); noise.start(t0); noise.stop(t0 + dur)

  const osc = ctx.createOscillator()
  osc.type = 'triangle'; osc.frequency.value = 185
  const og = ctx.createGain()
  og.gain.setValueAtTime(0.5, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07)
  osc.connect(og); og.connect(dest); osc.start(t0); osc.stop(t0 + 0.07)
}

function synthHihat(ctx, t0, dest, open = false) {
  const dur = open ? 0.25 : 0.04
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (dur + 0.01)), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource()
  noise.buffer = buf
  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'; hpf.frequency.value = 7000
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(open ? 0.35 : 0.28, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  noise.connect(hpf); hpf.connect(gain); gain.connect(dest)
  noise.start(t0); noise.stop(t0 + dur + 0.01)
}

function encodeWav(ab) {
  const nCh = ab.numberOfChannels, sr = ab.sampleRate, len = ab.length
  const blockAlign = nCh * 2, dataSize = len * blockAlign
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true)
  ws(8, 'WAVE'); ws(12, 'fmt ')
  v.setUint32(16, 16, true);  v.setUint16(20, 1, true)
  v.setUint16(22, nCh, true); v.setUint32(24, sr, true)
  v.setUint32(28, sr * blockAlign, true)
  v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true)
  ws(36, 'data'); v.setUint32(40, dataSize, true)
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nCh; ch++) {
      const s = Math.max(-1, Math.min(1, ab.getChannelData(ch)[i]))
      v.setInt16(off, s < 0 ? s * 32768 : s * 32767, true)
      off += 2
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MusicPage({ sharedId = null, onIdLoad } = {}) {
  const [inputId,     setInputId]     = useState('')
  const [normieId,    setNormieId]    = useState(null)
  const [localGrid,   setLocalGrid]   = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [audioParams, setAudioParams] = useState(null)
  const [playing,     setPlaying]     = useState(false)
  const [looping,     setLooping]     = useState(false)
  const [currentBeat, setCurrentBeat] = useState(-1)
  const [vizMode,     setVizMode]     = useState('WAVEFORM')
  const [colorway,    setColorway]    = useState('original')
  const [exporting,   setExporting]   = useState(false)
  const [audioReady,  setAudioReady]  = useState(false)
  const [bpm,         setBpm]         = useState(120)
  const [bpmDraft,    setBpmDraft]    = useState('120')
  const [drumGrid,    setDrumGrid]    = useState(null)

  const pianoRollRef   = useRef(null)
  const drumCanvasRef  = useRef(null)
  const vizCanvasRef   = useRef(null)
  const audioCtxRef    = useRef(null)
  const analyserRef    = useRef(null)
  const masterGainRef  = useRef(null)
  const convolverRef   = useRef(null)
  const beatTimerRef   = useRef(null)
  const playingRef     = useRef(false)
  const loopingRef     = useRef(false)
  const audioParamsRef = useRef(null)
  const localGridRef   = useRef(null)
  const drumGridRef    = useRef(null)
  const bpmRef         = useRef(120)

  useEffect(() => { playingRef.current     = playing },    [playing])
  useEffect(() => { loopingRef.current     = looping },    [looping])
  useEffect(() => { audioParamsRef.current = audioParams }, [audioParams])
  useEffect(() => { localGridRef.current   = localGrid },  [localGrid])
  useEffect(() => { drumGridRef.current    = drumGrid },   [drumGrid])
  useEffect(() => { bpmRef.current         = bpm },        [bpm])

  // ── AudioContext setup (lazy — requires user gesture) ──────────────────
  function ensureAudioCtx() {
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
      return audioCtxRef.current
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    audioCtxRef.current = ctx

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.85
    analyserRef.current = analyser

    const masterGain = ctx.createGain()
    masterGain.gain.value = 0.6
    masterGainRef.current = masterGain

    // Reverb — always wired; notes route to it or bypass based on trait
    const conv = ctx.createConvolver()
    conv.buffer = createImpulse(ctx)
    conv.connect(masterGain)
    convolverRef.current = conv

    masterGain.connect(analyser)
    analyser.connect(ctx.destination)

    setAudioReady(true)
    return ctx
  }

  // ── Schedule a single note ─────────────────────────────────────────────
  function scheduleNote(ctx, freq, t0, noteDur, params) {
    const dest = params.hasReverb ? convolverRef.current : masterGainRef.current
    if (params.hasDetune) {
      const g1 = buildOscGain(ctx, freq, t0, noteDur, params.waveform, -8)
      const g2 = buildOscGain(ctx, freq, t0, noteDur, params.waveform,  8)
      const merge = ctx.createGain()
      merge.gain.value = 0.5
      g1.connect(merge); g2.connect(merge)
      merge.connect(dest)
    } else {
      buildOscGain(ctx, freq, t0, noteDur, params.waveform, 0).connect(dest)
    }
  }

  // ── Play all notes in one beat column ──────────────────────────────────
  function playColumn(ctx, col, t0, noteDur, params) {
    const freqs = buildNoteFreqs(params.octaveShift)
    const g = localGridRef.current
    if (!g) return
    for (let row = 0; row < GRID; row++) {
      if (g[row][col]) scheduleNote(ctx, freqs[GRID - 1 - row], t0, noteDur, params)
    }
  }

  // ── Play drums for one beat column ─────────────────────────────────────
  function playDrumColumn(ctx, col, t0) {
    const dg   = drumGridRef.current
    const dest = masterGainRef.current
    if (!dg || !dest) return
    if (dg[0][col]) synthKick(ctx, t0, dest)
    if (dg[1][col]) synthSnare(ctx, t0, dest)
    if (dg[2][col]) synthHihat(ctx, t0, dest, false)
    if (dg[3][col]) synthHihat(ctx, t0, dest, true)
  }

  // ── Sequencer ──────────────────────────────────────────────────────────
  function cancelPlayback() {
    if (beatTimerRef.current) { clearTimeout(beatTimerRef.current); beatTimerRef.current = null }
  }

  function stopPlayback() {
    playingRef.current = false
    cancelPlayback()
    setPlaying(false)
    setCurrentBeat(-1)
  }

  function startPlayback() {
    const ctx = ensureAudioCtx()
    const params = audioParamsRef.current
    if (!params) return
    let beat = 0

    function tick() {
      if (!playingRef.current) return
      if (beat >= GRID) {
        if (loopingRef.current) beat = 0
        else { setPlaying(false); setCurrentBeat(-1); return }
      }
      const currentBpm = bpmRef.current
      const beatMs  = 60000 / currentBpm
      const noteDur = (60 / currentBpm) * 0.8
      setCurrentBeat(beat)
      playColumn(ctx, beat, ctx.currentTime, noteDur, params)
      playDrumColumn(ctx, beat, ctx.currentTime)
      beat++
      beatTimerRef.current = setTimeout(tick, beatMs)
    }
    tick()
  }

  function handlePlayStop() {
    if (playingRef.current) {
      stopPlayback()
    } else {
      playingRef.current = true
      setPlaying(true)
      startPlayback()
    }
  }

  // ── Piano roll draw ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = pianoRollRef.current
    if (!canvas || !localGrid) return
    const cwObj = COLORWAYS.find(c => c.id === colorway)
    const ctx   = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const LABEL_W = 30
    const cellW = (W - LABEL_W) / GRID
    const cellH = H / GRID

    ctx.fillStyle = cwObj.off
    ctx.fillRect(0, 0, W, H)

    // Cells
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const x = LABEL_W + col * cellW
        const y = row * cellH
        ctx.fillStyle  = cwObj.on
        ctx.globalAlpha = localGrid[row][col] ? 1 : 0.06
        ctx.fillRect(x + 0.5, y + 0.5, cellW - 1, cellH - 0.5)
      }
    }
    ctx.globalAlpha = 1

    // Beat column highlight
    if (currentBeat >= 0 && currentBeat < GRID) {
      const x = LABEL_W + currentBeat * cellW
      ctx.fillStyle = cwObj.on
      ctx.globalAlpha = 0.18
      ctx.fillRect(x, 0, cellW, H)
      ctx.globalAlpha = 0.75
      ctx.fillRect(x, 0, cellW, 2)
      ctx.globalAlpha = 1
    }

    // Grid lines — subtle, bar lines stronger
    ctx.strokeStyle = cwObj.on
    for (let col = 0; col <= GRID; col++) {
      ctx.globalAlpha = col % 4 === 0 ? 0.22 : 0.06
      ctx.lineWidth   = col % 4 === 0 ? 1 : 0.5
      const x = LABEL_W + col * cellW
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let row = 0; row <= GRID; row++) {
      ctx.globalAlpha = row % 5 === 0 ? 0.18 : 0.04
      ctx.lineWidth = 0.5
      const y = row * cellH
      ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(W, y); ctx.stroke()
    }
    ctx.globalAlpha = 1

    // Note labels (C notes only)
    ctx.font         = `${Math.max(7, Math.floor(cellH * 0.72))}px "Courier New", monospace`
    ctx.textAlign    = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillStyle    = cwObj.on
    for (let row = 0; row < GRID; row++) {
      const noteIdx = GRID - 1 - row
      if (noteIdx % 5 === 0) {
        ctx.globalAlpha = 0.5
        ctx.fillText(`C${Math.floor(noteIdx / 5) + 1}`, LABEL_W - 3, row * cellH + cellH / 2)
      }
    }
    ctx.globalAlpha = 1
  }, [localGrid, currentBeat, colorway])

  // ── Drum grid draw ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = drumCanvasRef.current
    if (!canvas || !drumGrid) return
    const cwObj = COLORWAYS.find(c => c.id === colorway)
    const ctx   = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const LABEL_W = 30
    const cellW = (W - LABEL_W) / GRID
    const rowH  = H / 4

    ctx.fillStyle = cwObj.off
    ctx.fillRect(0, 0, W, H)

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < GRID; col++) {
        const x = LABEL_W + col * cellW
        const y = row * rowH
        ctx.fillStyle   = cwObj.on
        ctx.globalAlpha = drumGrid[row][col] ? 0.88 : 0.06
        ctx.fillRect(x + 0.5, y + 0.5, cellW - 1, rowH - 1)
      }
    }
    ctx.globalAlpha = 1

    if (currentBeat >= 0 && currentBeat < GRID) {
      const x = LABEL_W + currentBeat * cellW
      ctx.fillStyle = cwObj.on
      ctx.globalAlpha = 0.18
      ctx.fillRect(x, 0, cellW, H)
      ctx.globalAlpha = 0.75
      ctx.fillRect(x, 0, cellW, 2)
      ctx.globalAlpha = 1
    }

    ctx.strokeStyle = cwObj.on
    for (let col = 0; col <= GRID; col++) {
      ctx.globalAlpha = col % 4 === 0 ? 0.22 : 0.06
      ctx.lineWidth   = col % 4 === 0 ? 1 : 0.5
      const x = LABEL_W + col * cellW
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let row = 0; row <= 4; row++) {
      ctx.globalAlpha = 0.18; ctx.lineWidth = 0.5
      const y = row * rowH
      ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(W, y); ctx.stroke()
    }
    ctx.globalAlpha = 1

    ctx.font = `8px "Courier New", monospace`
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillStyle = cwObj.on
    for (let row = 0; row < 4; row++) {
      ctx.globalAlpha = 0.55
      ctx.fillText(DRUM_LABELS[row], LABEL_W - 3, row * rowH + rowH / 2)
    }
    ctx.globalAlpha = 1
  }, [drumGrid, currentBeat, colorway])

  // ── Visualizer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!audioReady || !analyserRef.current) return
    const canvas  = vizCanvasRef.current
    if (!canvas) return
    const analyser = analyserRef.current
    const W = canvas.width, H = canvas.height
    const ctx  = canvas.getContext('2d')
    const cwObj = COLORWAYS.find(c => c.id === colorway)
    let rafId = null

    function draw() {
      rafId = requestAnimationFrame(draw)
      ctx.fillStyle = cwObj.off
      ctx.fillRect(0, 0, W, H)

      if (vizMode === 'WAVEFORM') {
        const buf = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(buf)
        ctx.beginPath()
        ctx.strokeStyle = cwObj.on
        ctx.lineWidth   = 1.5
        const step = W / buf.length
        for (let i = 0; i < buf.length; i++) {
          const x = i * step
          const y = (0.5 - buf[i] * 0.45) * H
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.strokeStyle = cwObj.on
        ctx.globalAlpha = 0.1
        ctx.lineWidth   = 1
        ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
        ctx.globalAlpha = 1

      } else {
        const N = 64
        const freqBuf = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(freqBuf)
        const barW = W / N

        for (let i = 0; i < N; i++) {
          const idx = Math.floor(i * analyser.frequencyBinCount / N)
          const v   = freqBuf[idx] / 255
          if (v <= 0) continue
          const barH = v * H
          const x = i * barW, y = H - barH
          const grad = ctx.createLinearGradient(0, H, 0, y)
          grad.addColorStop(0, cwObj.off)
          grad.addColorStop(1, cwObj.on)
          ctx.fillStyle = grad

          const r = Math.min(2, barW / 2 - 0.5)
          if (barH > r * 2 + 1 && typeof ctx.roundRect === 'function') {
            ctx.beginPath()
            ctx.roundRect(x + 0.5, y, barW - 1, barH, [r, r, 0, 0])
            ctx.fill()
          } else {
            ctx.fillRect(x + 0.5, y, barW - 1, barH)
          }
        }
      }
    }

    draw()
    return () => { if (rafId) cancelAnimationFrame(rafId) }
  }, [audioReady, vizMode, colorway])

  // ── Piano roll click — toggle cells ───────────────────────────────────
  function handleRollClick(e) {
    const canvas = pianoRollRef.current
    if (!canvas || !localGrid) return
    const rect  = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top)  * scaleY
    const LABEL_W = 30
    const cellW = (canvas.width  - LABEL_W) / GRID
    const cellH =  canvas.height / GRID
    const col = Math.floor((px - LABEL_W) / cellW)
    const row = Math.floor(py / cellH)
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return
    setLocalGrid(prev => {
      const next = prev.map(r => [...r])
      next[row][col] = !next[row][col]
      return next
    })
  }

  // ── Drum grid click — toggle cells ───────────────────────────────────
  function handleDrumClick(e) {
    const canvas = drumCanvasRef.current
    if (!canvas || !drumGrid) return
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top)  * scaleY
    const LABEL_W = 30
    const cellW = (canvas.width - LABEL_W) / GRID
    const rowH  = canvas.height / 4
    const col = Math.floor((px - LABEL_W) / cellW)
    const row = Math.floor(py / rowH)
    if (col < 0 || col >= GRID || row < 0 || row >= 4) return
    setDrumGrid(prev => {
      const next = prev.map(r => [...r])
      next[row][col] = !next[row][col]
      return next
    })
  }

  // ── Load ──────────────────────────────────────────────────────────────
  async function loadById(id) {
    stopPlayback()
    setLoading(true)
    setError(null)
    setLocalGrid(null)
    setDrumGrid(null)
    setAudioParams(null)
    setCurrentBeat(-1)

    try {
      const [pixRes, traitRes] = await Promise.all([
        fetch(`${API_BASE}/normie/${id}/pixels`),
        fetch(`${API_BASE}/normie/${id}/traits`),
      ])
      if (!pixRes.ok) throw new Error(`Token #${id} not found (${pixRes.status})`)
      const raw = (await pixRes.text()).trim()
      if (raw.length < 1600) throw new Error(`Pixel data unavailable for #${id}`)
      const parsedGrid = parseGrid(raw.slice(0, 1600))

      let traitData = {}
      if (traitRes.ok) {
        const td = await traitRes.json()
        traitData = td.attributes ?? td
      }

      const params = getAudioParams(traitData)
      setLocalGrid(parsedGrid)
      setDrumGrid([
        parsedGrid[39].slice(), // KICK — bottom row
        parsedGrid[38].slice(), // SNARE
        parsedGrid[37].slice(), // HH
        parsedGrid[36].slice(), // OPEN
      ])
      setAudioParams(params)
      setBpm(params.bpm)
      setBpmDraft(String(params.bpm))
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

  function handleKeyDown(e) { if (e.key === 'Enter') loadNormie() }

  useEffect(() => {
    if (sharedId === null || sharedId === normieId) return
    setInputId(String(sharedId))
    loadById(sharedId)
  }, [sharedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── WAV export ────────────────────────────────────────────────────────
  async function handleExport() {
    if (!localGrid || !audioParams || normieId === null) return
    setExporting(true)
    try {
      const params  = audioParams
      const beatDur = 60 / bpmRef.current
      const noteDur = beatDur * 0.8
      const SR = 44100
      const offCtx = new OfflineAudioContext(
        2, Math.ceil((GRID * beatDur + 1.5) * SR), SR
      )
      const masterOff = offCtx.createGain()
      masterOff.gain.value = 0.6
      masterOff.connect(offCtx.destination)

      let convOff = null
      if (params.hasReverb) {
        convOff = offCtx.createConvolver()
        convOff.buffer = createImpulse(offCtx)
        convOff.connect(masterOff)
      }

      const freqs = buildNoteFreqs(params.octaveShift)
      const g     = localGridRef.current

      for (let col = 0; col < GRID; col++) {
        const t0   = col * beatDur
        const dest = convOff || masterOff
        for (let row = 0; row < GRID; row++) {
          if (!g[row][col]) continue
          const freq = freqs[GRID - 1 - row]
          if (params.hasDetune) {
            const g1 = buildOscGain(offCtx, freq, t0, noteDur, params.waveform, -8)
            const g2 = buildOscGain(offCtx, freq, t0, noteDur, params.waveform,  8)
            const merge = offCtx.createGain()
            merge.gain.value = 0.5
            g1.connect(merge); g2.connect(merge)
            merge.connect(dest)
          } else {
            buildOscGain(offCtx, freq, t0, noteDur, params.waveform, 0).connect(dest)
          }
        }
      }

      // Drums
      const dg = drumGridRef.current
      if (dg) {
        for (let col = 0; col < GRID; col++) {
          const t0 = col * beatDur
          if (dg[0][col]) synthKick(offCtx,   t0, masterOff)
          if (dg[1][col]) synthSnare(offCtx,  t0, masterOff)
          if (dg[2][col]) synthHihat(offCtx,  t0, masterOff, false)
          if (dg[3][col]) synthHihat(offCtx,  t0, masterOff, true)
        }
      }

      const audioBuf = await offCtx.startRendering()
      const wav = encodeWav(audioBuf)
      const url = URL.createObjectURL(wav)
      const a = document.createElement('a')
      a.href = url; a.download = `normie-${normieId}-music.wav`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('WAV export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelPlayback()
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close()
      }
    }
  }, [])

  return (
    <div className="music-page">
      <header className="header">
        <h1 className="title">Normie Music</h1>
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

      {audioParams && (
        <div className="music-meta">
          <span className="music-tag">{audioParams.waveform}</span>
          {audioParams.hasReverb  && <span className="music-tag">reverb</span>}
          {audioParams.hasDetune  && <span className="music-tag">chorus</span>}
          {audioParams.octaveShift > 0 && <span className="music-tag">+1 oct</span>}
          {audioParams.octaveShift < 0 && <span className="music-tag">-1 oct</span>}
        </div>
      )}

      {localGrid && (
        <>
          <div className="music-controls">
            <div className="delay-control">
              <input
                type="text"
                inputMode="numeric"
                className="delay-input"
                value={bpmDraft}
                onChange={e => setBpmDraft(e.target.value)}
                onBlur={() => {
                  const n = parseInt(bpmDraft, 10)
                  const clamped = isNaN(n) ? bpm : Math.max(20, Math.min(300, n))
                  setBpm(clamped)
                  setBpmDraft(String(clamped))
                }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              />
              <span className="delay-unit">BPM</span>
            </div>
            <button
              className={`play-btn${playing ? ' active' : ''}`}
              onClick={handlePlayStop}
            >
              {playing ? 'Stop' : 'Play'}
            </button>
            <button
              className={`play-btn${looping ? ' active' : ''}`}
              onClick={() => setLooping(l => !l)}
            >
              Loop
            </button>
          </div>

          <div className="piano-roll-wrap">
            <canvas
              ref={pianoRollRef}
              width={680}
              height={400}
              className="piano-roll-canvas"
              onClick={handleRollClick}
            />
          </div>

          <div className="drum-roll-wrap">
            <canvas
              ref={drumCanvasRef}
              width={680}
              height={120}
              className="drum-roll-canvas"
              onClick={handleDrumClick}
            />
          </div>

          <div className="music-viz-bar">
            <div className="music-viz-btns">
              <button
                className={`viz-btn${vizMode === 'WAVEFORM' ? ' active' : ''}`}
                onClick={() => setVizMode('WAVEFORM')}
              >Waveform</button>
              <button
                className={`viz-btn${vizMode === 'FREQUENCY' ? ' active' : ''}`}
                onClick={() => setVizMode('FREQUENCY')}
              >Frequency</button>
            </div>
            {!audioReady && (
              <span className="music-hint">press play to activate</span>
            )}
          </div>

          <div className="viz-canvas-wrap">
            <canvas
              ref={vizCanvasRef}
              width={680}
              height={180}
              className="music-viz-canvas"
            />
          </div>

          <div className="effects-panel music-panel">
            <span className="effects-label">Colorways</span>
            <div className="effects-row">
              {COLORWAYS.map(c => (
                <button
                  key={c.id}
                  className={`effect-btn${colorway === c.id ? ' active' : ''}`}
                  onClick={() => setColorway(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              className="download-btn"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Rendering…' : 'Export WAV'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
