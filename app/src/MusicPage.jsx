import { useState, useEffect, useRef } from 'react'
import './MusicPage.css'

const API_BASE     = 'https://api.normies.art'
const GRID         = 40
const MELODY_ROWS  = 32
const DRUM_ROWS    = 8
const MELODY_ROW_H = 10
const DRUM_ROW_H   = 20
const MELODY_H     = MELODY_ROWS * MELODY_ROW_H  // 320
const DRUM_H       = DRUM_ROWS * DRUM_ROW_H       // 160
const CANVAS_H     = MELODY_H + DRUM_H            // 480
const CANVAS_W     = 680
const LABEL_W      = 46

const DRUM_LABELS = ['KICK', 'SNARE', 'HH', 'OPEN', 'CLAP', 'RIM', 'TOM H', 'TOM L']

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

const PENTA = [0, 2, 4, 7, 9]

// 32 pentatonic frequencies, index 0 = lowest
function buildMelodyFreqs(octaveShift = 0) {
  const freqs = []
  for (let oct = 1; oct <= 8; oct++) {
    for (const semi of PENTA) {
      const midi = 12 * (oct + 1 + octaveShift) + semi
      freqs.push(440 * Math.pow(2, (midi - 69) / 12))
      if (freqs.length >= MELODY_ROWS) return freqs
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
  else if (expr.includes('big smile'))    bpm = 160
  else if (expr.includes('serious'))      bpm = 90
  else if (expr.includes('sad'))          bpm = 70
  else if (expr.includes('angry'))        bpm = 180
  else if (expr.includes('surprised'))    bpm = 150

  const age = map['age'] || ''
  let octaveShift = 0
  if      (age.includes('young')) octaveShift = 1
  else if (age.includes('old'))   octaveShift = -1

  const acc = map['accessory'] || ''
  const hasReverb = acc.includes('hat') || acc.includes('cap') ||
    acc.includes('beanie') || acc.includes('crown') || acc.includes('top hat')

  const eyes = map['eyes'] || ''
  const hasDetune = eyes.includes('shade') || eyes.includes('sunglass')

  return { waveform, bpm, octaveShift, hasReverb, hasDetune }
}

// Short reverb impulse (~0.3s decay)
function createImpulse(ctx, decay = 0.3) {
  const len = Math.floor(ctx.sampleRate * decay)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    }
  }
  return buf
}

function makeNoteGain(ctx, t0, dur, pk = 0.06) {
  const g = ctx.createGain()
  const att = 0.01, dec = 0.1, sus = 0.6, rel = 0.2
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(pk,       t0 + att)
  g.gain.linearRampToValueAtTime(pk * sus, t0 + att + dec)
  g.gain.setValueAtTime(pk * sus,          t0 + dur)
  g.gain.linearRampToValueAtTime(0,        t0 + dur + rel)
  return g
}

function buildOscGain(ctx, freq, t0, dur, waveform, detuneCents, pk = 0.06) {
  const osc = ctx.createOscillator()
  osc.type = waveform
  osc.frequency.value = freq
  if (detuneCents) osc.detune.value = detuneCents
  osc.start(t0)
  osc.stop(t0 + dur + 0.4)
  const gain = makeNoteGain(ctx, t0, dur, pk)
  osc.connect(gain)
  return gain
}

// ── Drum synthesis ──────────────────────────────────────────────────────────

function synthKick(ctx, t0, dest) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(150, t0)
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.3)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(1.0, t0 + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4)
  osc.connect(gain); gain.connect(dest)
  osc.start(t0); osc.stop(t0 + 0.5)
}

function synthSnare(ctx, t0, dest) {
  const dur = 0.2
  ;[200, 180].forEach(f => {
    const osc = ctx.createOscillator()
    osc.frequency.value = f
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.4, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    osc.connect(g); g.connect(dest)
    osc.start(t0); osc.stop(t0 + dur)
  })
  const noiseLen = Math.ceil(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < noiseLen; i++) d[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = buf
  const bpf = ctx.createBiquadFilter()
  bpf.type = 'bandpass'; bpf.frequency.value = 1000; bpf.Q.value = 0.5
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.7, t0); ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  noise.connect(bpf); bpf.connect(ng); ng.connect(dest)
  noise.start(t0); noise.stop(t0 + dur)
}

function synthHihat(ctx, t0, dest, open = false) {
  const dur    = open ? 0.3 : 0.05
  const hpFreq = open ? 6000 : 8000
  const noiseLen = Math.ceil(ctx.sampleRate * (dur + 0.01))
  const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < noiseLen; i++) d[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = buf
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = hpFreq
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(open ? 0.4 : 0.3, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  noise.connect(hpf); hpf.connect(gain); gain.connect(dest)
  noise.start(t0); noise.stop(t0 + dur + 0.01)
}

function synthClap(ctx, t0, dest) {
  ;[0, 0.01, 0.02].forEach(offset => {
    const dur = 0.04
    const noiseLen = Math.ceil(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < noiseLen; i++) d[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource(); noise.buffer = buf
    const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 1200; bpf.Q.value = 1
    const gain = ctx.createGain()
    const t = t0 + offset
    gain.gain.setValueAtTime(0.6, t); gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
    noise.connect(bpf); bpf.connect(gain); gain.connect(dest)
    noise.start(t); noise.stop(t + dur)
  })
}

function synthRim(ctx, t0, dest) {
  const osc = ctx.createOscillator()
  osc.frequency.value = 1600
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.7, t0); gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05)
  osc.connect(gain); gain.connect(dest)
  osc.start(t0); osc.stop(t0 + 0.06)
}

function synthTom(ctx, t0, dest, startHz, endHz, dur) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(startHz, t0)
  osc.frequency.exponentialRampToValueAtTime(endHz, t0 + dur)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(0.8, t0 + 0.003)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  osc.connect(gain); gain.connect(dest)
  osc.start(t0); osc.stop(t0 + dur + 0.05)
}

function playDrums(ctx, step, g, dest) {
  if (g[32][step]) synthKick(ctx, ctx.currentTime, dest)
  if (g[33][step]) synthSnare(ctx, ctx.currentTime, dest)
  if (g[34][step]) synthHihat(ctx, ctx.currentTime, dest, false)
  if (g[35][step]) synthHihat(ctx, ctx.currentTime, dest, true)
  if (g[36][step]) synthClap(ctx, ctx.currentTime, dest)
  if (g[37][step]) synthRim(ctx, ctx.currentTime, dest)
  if (g[38][step]) synthTom(ctx, ctx.currentTime, dest, 120, 60, 0.2)
  if (g[39][step]) synthTom(ctx, ctx.currentTime, dest, 80, 35, 0.3)
}

function playDrumsAt(ctx, step, t0, g, dest) {
  if (g[32][step]) synthKick(ctx, t0, dest)
  if (g[33][step]) synthSnare(ctx, t0, dest)
  if (g[34][step]) synthHihat(ctx, t0, dest, false)
  if (g[35][step]) synthHihat(ctx, t0, dest, true)
  if (g[36][step]) synthClap(ctx, t0, dest)
  if (g[37][step]) synthRim(ctx, t0, dest)
  if (g[38][step]) synthTom(ctx, t0, dest, 120, 60, 0.2)
  if (g[39][step]) synthTom(ctx, t0, dest, 80, 35, 0.3)
}

function encodeWav(ab) {
  const nCh = ab.numberOfChannels, sr = ab.sampleRate, len = ab.length
  const blockAlign = nCh * 2, dataSize = len * blockAlign
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true)
  ws(8, 'WAVE'); ws(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, nCh, true); v.setUint32(24, sr, true)
  v.setUint32(28, sr * blockAlign, true)
  v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true)
  ws(36, 'data'); v.setUint32(40, dataSize, true)
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nCh; ch++) {
      const s = Math.max(-1, Math.min(1, ab.getChannelData(ch)[i]))
      v.setInt16(off, s < 0 ? s * 32768 : s * 32767, true); off += 2
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

// ── Component ───────────────────────────────────────────────────────────────

export default function MusicPage({ sharedId = null, onIdLoad } = {}) {
  const [inputId,     setInputId]     = useState('')
  const [normieId,    setNormieId]    = useState(null)
  const [localGrid,   setLocalGrid]   = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [audioParams, setAudioParams] = useState(null)
  const [playing,     setPlaying]     = useState(false)
  const [looping,     setLooping]     = useState(true)   // default ON
  const [currentBeat, setCurrentBeat] = useState(-1)
  const [vizMode,     setVizMode]     = useState('WAVEFORM')
  const [colorway,    setColorway]    = useState('original')
  const [exporting,   setExporting]   = useState(false)
  const [audioReady,  setAudioReady]  = useState(false)
  const [bpm,         setBpm]         = useState(120)
  const [bpmDraft,    setBpmDraft]    = useState('120')
  const [swing,       setSwing]       = useState(0.25)

  const canvasRef      = useRef(null)
  const vizCanvasRef   = useRef(null)
  const audioCtxRef    = useRef(null)
  const analyserRef    = useRef(null)
  const masterGainRef  = useRef(null)
  const convolverRef   = useRef(null)
  const beatTimerRef   = useRef(null)
  const playingRef     = useRef(false)
  const loopingRef     = useRef(true)
  const audioParamsRef = useRef(null)
  const localGridRef   = useRef(null)
  const bpmRef         = useRef(120)
  const swingRef       = useRef(0.25)

  useEffect(() => { playingRef.current     = playing },    [playing])
  useEffect(() => { loopingRef.current     = looping },    [looping])
  useEffect(() => { audioParamsRef.current = audioParams }, [audioParams])
  useEffect(() => { localGridRef.current   = localGrid },  [localGrid])
  useEffect(() => { bpmRef.current         = bpm },        [bpm])
  useEffect(() => { swingRef.current       = swing },      [swing])

  // ── AudioContext (lazy) ────────────────────────────────────────────────
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

    const conv = ctx.createConvolver()
    conv.buffer = createImpulse(ctx, 0.3)
    conv.connect(masterGain)
    convolverRef.current = conv

    masterGain.connect(analyser)
    analyser.connect(ctx.destination)

    setAudioReady(true)
    return ctx
  }

  // ── Schedule a melody note ─────────────────────────────────────────────
  function scheduleNote(ctx, freq, t0, noteDur, params, gainScale = 1) {
    const dest = params.hasReverb ? convolverRef.current : masterGainRef.current
    const pk = 0.06 * gainScale
    if (params.hasDetune) {
      const g1 = buildOscGain(ctx, freq, t0, noteDur, params.waveform, -8, pk)
      const g2 = buildOscGain(ctx, freq, t0, noteDur, params.waveform,  8, pk)
      const merge = ctx.createGain(); merge.gain.value = 0.5
      g1.connect(merge); g2.connect(merge); merge.connect(dest)
    } else {
      buildOscGain(ctx, freq, t0, noteDur, params.waveform, 0, pk).connect(dest)
    }
  }

  // ── Play one 16th-note step ────────────────────────────────────────────
  function playStep(ctx, step) {
    const g = localGridRef.current
    const params = audioParamsRef.current
    if (!g || !params) return

    const s16 = (60 / bpmRef.current) / 4
    const noteDur = s16 * 0.8
    const t0 = ctx.currentTime
    const freqs = buildMelodyFreqs(params.octaveShift)

    // Collect active melody notes, scale volume for chords
    const active = []
    for (let row = 0; row < MELODY_ROWS; row++) {
      if (g[row][step]) active.push(row)
    }
    const chordScale = active.length >= 3 ? 0.6 / active.length : 1

    for (const row of active) {
      // Position-based velocity: centre of grid is loudest
      const velRow = 1 - Math.abs(row - 15.5) / 16
      const velCol = 1 - Math.abs(step - 19.5) / 20
      const vel = 0.6 + 0.4 * (velRow + velCol) / 2
      scheduleNote(ctx, freqs[MELODY_ROWS - 1 - row], t0, noteDur, params, vel * chordScale)
    }

    playDrums(ctx, step, g, masterGainRef.current)
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
    let step = 0

    function tick() {
      if (!playingRef.current) return
      if (step >= GRID) {
        if (loopingRef.current) step = 0
        else { setPlaying(false); setCurrentBeat(-1); return }
      }
      setCurrentBeat(step)
      playStep(ctx, step)

      // Swing timing: even→odd gap is long, odd→even is short
      const s16Ms = (60 / bpmRef.current) / 4 * 1000
      const sw = swingRef.current
      const gap = step % 2 === 0
        ? s16Ms * (1 + 2 * sw)
        : s16Ms * (1 - 2 * sw)
      step++
      beatTimerRef.current = setTimeout(tick, gap)
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

  function nudgeBpm(delta) {
    setBpm(prev => {
      const n = Math.max(20, Math.min(300, prev + delta))
      setBpmDraft(String(n))
      return n
    })
  }

  // ── Unified piano-roll + drum canvas ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !localGrid) return
    const cw  = COLORWAYS.find(c => c.id === colorway)
    const ctx = canvas.getContext('2d')
    const W   = canvas.width

    // Background
    ctx.fillStyle = cw.off
    ctx.fillRect(0, 0, W, CANVAS_H)

    // Slight tint on drum section
    ctx.fillStyle = cw.on
    ctx.globalAlpha = 0.05
    ctx.fillRect(0, MELODY_H, W, DRUM_H)
    ctx.globalAlpha = 1

    const cellW = (W - LABEL_W) / GRID

    // ── Melody cells ──
    for (let row = 0; row < MELODY_ROWS; row++) {
      for (let col = 0; col < GRID; col++) {
        ctx.fillStyle   = cw.on
        ctx.globalAlpha = localGrid[row][col] ? 1 : 0.06
        ctx.fillRect(LABEL_W + col * cellW + 0.5, row * MELODY_ROW_H + 0.5, cellW - 1, MELODY_ROW_H - 0.5)
      }
    }

    // ── Drum cells ──
    for (let dr = 0; dr < DRUM_ROWS; dr++) {
      const row = MELODY_ROWS + dr
      for (let col = 0; col < GRID; col++) {
        ctx.fillStyle   = cw.on
        ctx.globalAlpha = localGrid[row][col] ? 0.9 : 0.06
        ctx.fillRect(LABEL_W + col * cellW + 0.5, MELODY_H + dr * DRUM_ROW_H + 0.5, cellW - 1, DRUM_ROW_H - 1)
      }
    }
    ctx.globalAlpha = 1

    // ── Active beat highlight + drum pulse ──
    if (currentBeat >= 0 && currentBeat < GRID) {
      const bx = LABEL_W + currentBeat * cellW
      ctx.fillStyle = cw.on
      ctx.globalAlpha = 0.15
      ctx.fillRect(bx, 0, cellW, CANVAS_H)
      ctx.globalAlpha = 0.7
      ctx.fillRect(bx, 0, cellW, 2)
      ctx.globalAlpha = 1

      // Pulse drum rows that fired this step
      for (let dr = 0; dr < DRUM_ROWS; dr++) {
        if (localGrid[MELODY_ROWS + dr][currentBeat]) {
          ctx.fillStyle   = cw.on
          ctx.globalAlpha = 0.45
          ctx.fillRect(bx + 0.5, MELODY_H + dr * DRUM_ROW_H + 0.5, cellW - 1, DRUM_ROW_H - 1)
          ctx.globalAlpha = 1
        }
      }
    }

    // ── Melody grid lines ──
    ctx.strokeStyle = cw.on
    for (let col = 0; col <= GRID; col++) {
      ctx.globalAlpha = col % 4 === 0 ? 0.22 : 0.06
      ctx.lineWidth   = col % 4 === 0 ? 1 : 0.5
      const x = LABEL_W + col * cellW
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MELODY_H); ctx.stroke()
    }
    for (let r = 0; r <= MELODY_ROWS; r++) {
      ctx.globalAlpha = r % 5 === 0 ? 0.18 : 0.04
      ctx.lineWidth = 0.5
      const y = r * MELODY_ROW_H
      ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(W, y); ctx.stroke()
    }

    // ── Separator ──
    ctx.strokeStyle = cw.on; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(0, MELODY_H); ctx.lineTo(W, MELODY_H); ctx.stroke()

    // ── Drum grid lines ──
    ctx.lineWidth = 0.5
    for (let col = 0; col <= GRID; col++) {
      ctx.globalAlpha = col % 4 === 0 ? 0.22 : 0.06
      const x = LABEL_W + col * cellW
      ctx.beginPath(); ctx.moveTo(x, MELODY_H); ctx.lineTo(x, CANVAS_H); ctx.stroke()
    }
    for (let dr = 0; dr <= DRUM_ROWS; dr++) {
      ctx.globalAlpha = 0.18
      const y = MELODY_H + dr * DRUM_ROW_H
      ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(W, y); ctx.stroke()
    }
    ctx.globalAlpha = 1

    // ── Melody note labels (C notes only) ──
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = cw.on
    ctx.font = `${Math.max(7, Math.floor(MELODY_ROW_H * 0.7))}px "Courier New",monospace`
    for (let row = 0; row < MELODY_ROWS; row++) {
      const noteIdx = MELODY_ROWS - 1 - row
      if (noteIdx % 5 === 0) {
        ctx.globalAlpha = 0.5
        ctx.fillText(`C${Math.floor(noteIdx / 5) + 1}`, LABEL_W - 3, row * MELODY_ROW_H + MELODY_ROW_H / 2)
      }
    }

    // ── Drum labels ──
    ctx.font = '7px "Courier New",monospace'
    for (let dr = 0; dr < DRUM_ROWS; dr++) {
      ctx.globalAlpha = 0.6
      ctx.fillText(DRUM_LABELS[dr], LABEL_W - 3, MELODY_H + dr * DRUM_ROW_H + DRUM_ROW_H / 2)
    }
    ctx.globalAlpha = 1

  }, [localGrid, currentBeat, colorway])

  // ── Visualizer + VU meter ──────────────────────────────────────────────
  useEffect(() => {
    if (!audioReady || !analyserRef.current) return
    const canvas = vizCanvasRef.current
    if (!canvas) return
    const analyser = analyserRef.current
    const W = canvas.width, H = canvas.height
    const VU_W   = 18
    const VIZ_W  = W - VU_W - 6
    const ctx    = canvas.getContext('2d')
    const cw     = COLORWAYS.find(c => c.id === colorway)
    let rafId    = null
    let vuPeak   = 0

    function draw() {
      rafId = requestAnimationFrame(draw)
      ctx.fillStyle = cw.off
      ctx.fillRect(0, 0, W, H)

      if (vizMode === 'WAVEFORM') {
        const buf = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(buf)

        let rms = 0
        for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]
        vuPeak = Math.max(vuPeak * 0.94, Math.sqrt(rms / buf.length))

        // Gradient waveform: bright at amplitude peaks
        const grad = ctx.createLinearGradient(0, 0, 0, H)
        grad.addColorStop(0,   cw.on)
        grad.addColorStop(0.5, cw.off)
        grad.addColorStop(1,   cw.on)

        const step = VIZ_W / buf.length
        // Filled body
        ctx.beginPath()
        ctx.moveTo(0, H / 2)
        for (let i = 0; i < buf.length; i++) {
          ctx.lineTo(i * step, (0.5 - buf[i] * 0.45) * H)
        }
        ctx.lineTo(VIZ_W, H / 2)
        ctx.closePath()
        ctx.fillStyle = grad; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1

        // Line
        ctx.beginPath()
        ctx.strokeStyle = grad; ctx.lineWidth = 1.5
        for (let i = 0; i < buf.length; i++) {
          const x = i * step, y = (0.5 - buf[i] * 0.45) * H
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()

        // Centre line
        ctx.strokeStyle = cw.on; ctx.globalAlpha = 0.08; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(VIZ_W, H / 2); ctx.stroke()
        ctx.globalAlpha = 1

      } else {
        const N = 64
        const freqBuf = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(freqBuf)
        let peak = 0
        for (let i = 0; i < freqBuf.length; i++) peak = Math.max(peak, freqBuf[i])
        vuPeak = Math.max(vuPeak * 0.94, peak / 255)

        const barW = VIZ_W / N
        for (let i = 0; i < N; i++) {
          const idx  = Math.floor(i * analyser.frequencyBinCount / N)
          const v    = freqBuf[idx] / 255
          if (v <= 0) continue
          const barH = v * H
          const x = i * barW, y = H - barH
          const grad = ctx.createLinearGradient(0, H, 0, y)
          grad.addColorStop(0, cw.off); grad.addColorStop(1, cw.on)
          ctx.fillStyle = grad
          const r = Math.min(2, barW / 2 - 0.5)
          if (barH > r * 2 + 1 && typeof ctx.roundRect === 'function') {
            ctx.beginPath(); ctx.roundRect(x + 0.5, y, barW - 1, barH, [r, r, 0, 0]); ctx.fill()
          } else {
            ctx.fillRect(x + 0.5, y, barW - 1, barH)
          }
        }
      }

      // ── VU meter ──
      const vuX  = VIZ_W + 6
      const vuH  = Math.min(H, vuPeak * H * 6)  // boost RMS for visibility
      ctx.fillStyle = cw.on; ctx.globalAlpha = 0.12
      ctx.fillRect(vuX, 0, VU_W, H)
      ctx.globalAlpha = 1
      if (vuH > 0) {
        const vuGrad = ctx.createLinearGradient(0, H, 0, H - vuH)
        vuGrad.addColorStop(0, cw.on); vuGrad.addColorStop(0.7, cw.on); vuGrad.addColorStop(1, cw.off)
        ctx.fillStyle = vuGrad
        ctx.fillRect(vuX + 2, H - vuH, VU_W - 4, vuH)
      }
    }

    draw()
    return () => { if (rafId) cancelAnimationFrame(rafId) }
  }, [audioReady, vizMode, colorway])

  // ── Click to toggle cells ──────────────────────────────────────────────
  function handleRollClick(e) {
    const canvas = canvasRef.current
    if (!canvas || !localGrid) return
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top)  * scaleY
    if (px < LABEL_W) return
    const col = Math.floor((px - LABEL_W) / ((canvas.width - LABEL_W) / GRID))
    if (col < 0 || col >= GRID) return

    let row
    if (py < MELODY_H) {
      row = Math.floor(py / MELODY_ROW_H)
      if (row >= MELODY_ROWS) return
    } else {
      row = MELODY_ROWS + Math.floor((py - MELODY_H) / DRUM_ROW_H)
      if (row >= GRID) return
    }

    setLocalGrid(prev => {
      const next = prev.map(r => [...r])
      next[row][col] = !next[row][col]
      return next
    })
  }

  // ── Load ──────────────────────────────────────────────────────────────
  async function loadById(id) {
    stopPlayback()
    setLoading(true); setError(null); setLocalGrid(null); setAudioParams(null); setCurrentBeat(-1)
    try {
      const [pixRes, traitRes] = await Promise.all([
        fetch(`${API_BASE}/normie/${id}/pixels`),
        fetch(`${API_BASE}/normie/${id}/traits`),
      ])
      if (!pixRes.ok) throw new Error(`Token #${id} not found (${pixRes.status})`)
      const raw = (await pixRes.text()).trim()
      if (raw.length < 1600) throw new Error(`Pixel data unavailable for #${id}`)
      const parsed = parseGrid(raw.slice(0, 1600))

      let traitData = {}
      if (traitRes.ok) {
        const td = await traitRes.json()
        traitData = td.attributes ?? td
      }
      const params = getAudioParams(traitData)

      // Build unified 40-row grid: melody (rows 0-31) + drums (rows 32-39)
      const grid = []
      for (let r = 0; r < MELODY_ROWS; r++) grid.push([...parsed[r]])
      // Seed drums from bottom pixel rows (reversed: row 39 → KICK, etc.)
      for (let dr = 0; dr < DRUM_ROWS; dr++) grid.push([...parsed[GRID - 1 - dr]])

      setLocalGrid(grid)
      setAudioParams(params)
      setBpm(params.bpm); setBpmDraft(String(params.bpm))
      setNormieId(id); onIdLoad?.(id)
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

  // ── WAV export (with swing timing) ────────────────────────────────────
  async function handleExport() {
    if (!localGrid || !audioParams || normieId === null) return
    setExporting(true)
    try {
      const params  = audioParams
      const s16     = (60 / bpmRef.current) / 4
      const sw      = swingRef.current
      const SR      = 44100
      const totalDur = GRID * s16 * (1 + sw) + 1.5
      const offCtx  = new OfflineAudioContext(2, Math.ceil(totalDur * SR), SR)

      const masterOff = offCtx.createGain(); masterOff.gain.value = 0.6
      masterOff.connect(offCtx.destination)

      let convOff = null
      if (params.hasReverb) {
        convOff = offCtx.createConvolver()
        convOff.buffer = createImpulse(offCtx, 0.3)
        convOff.connect(masterOff)
      }

      const freqs = buildMelodyFreqs(params.octaveShift)
      const g     = localGridRef.current

      function stepTime(n) {
        return n * s16 + (n % 2 === 1 ? sw * 2 * s16 : 0)
      }

      for (let col = 0; col < GRID; col++) {
        const t0      = stepTime(col)
        const noteDur = s16 * 0.8
        const dest    = convOff || masterOff

        const active = []
        for (let row = 0; row < MELODY_ROWS; row++) { if (g[row][col]) active.push(row) }
        const chordScale = active.length >= 3 ? 0.6 / active.length : 1

        for (const row of active) {
          const velRow = 1 - Math.abs(row - 15.5) / 16
          const velCol = 1 - Math.abs(col - 19.5) / 20
          const vel = 0.6 + 0.4 * (velRow + velCol) / 2
          const pk  = 0.06 * vel * chordScale
          if (params.hasDetune) {
            const g1 = buildOscGain(offCtx, freqs[MELODY_ROWS - 1 - row], t0, noteDur, params.waveform, -8, pk)
            const g2 = buildOscGain(offCtx, freqs[MELODY_ROWS - 1 - row], t0, noteDur, params.waveform,  8, pk)
            const merge = offCtx.createGain(); merge.gain.value = 0.5
            g1.connect(merge); g2.connect(merge); merge.connect(dest)
          } else {
            buildOscGain(offCtx, freqs[MELODY_ROWS - 1 - row], t0, noteDur, params.waveform, 0, pk).connect(dest)
          }
        }

        playDrumsAt(offCtx, col, t0, g, masterOff)
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

  // ── Render ─────────────────────────────────────────────────────────────
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
          min="0" max="9999"
          placeholder="Token ID (0–9999)"
          value={inputId}
          onChange={e => setInputId(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="load-btn" onClick={loadNormie} disabled={loading}>
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>

      {error   && <p className="error">{error}</p>}
      {loading && (
        <div className="loading"><div className="spinner" /><span>Fetching Normie…</span></div>
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
          {/* ── Controls ── */}
          <div className="music-controls">
            <div className="delay-control">
              <button className="bpm-nudge" onClick={() => nudgeBpm(-5)}>−5</button>
              <input
                type="text"
                inputMode="numeric"
                className="delay-input"
                value={bpmDraft}
                onChange={e => setBpmDraft(e.target.value)}
                onBlur={() => {
                  const n = parseInt(bpmDraft, 10)
                  const c = isNaN(n) ? bpm : Math.max(20, Math.min(300, n))
                  setBpm(c); setBpmDraft(String(c))
                }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              />
              <button className="bpm-nudge" onClick={() => nudgeBpm(5)}>+5</button>
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

          {/* ── Swing ── */}
          <div className="music-swing-bar">
            <span className="swing-label">SWING</span>
            <input
              type="range"
              min="0" max="50"
              value={Math.round(swing * 100)}
              onChange={e => setSwing(parseInt(e.target.value, 10) / 100)}
              className="swing-slider"
            />
            <span className="swing-val">{Math.round(swing * 100)}%</span>
          </div>

          {/* ── Unified piano roll + drum grid ── */}
          <div className="piano-roll-wrap">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="piano-roll-canvas"
              onClick={handleRollClick}
            />
          </div>

          {/* ── Visualizer ── */}
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
            {!audioReady && <span className="music-hint">press play to activate</span>}
          </div>

          <div className="viz-canvas-wrap">
            <canvas
              ref={vizCanvasRef}
              width={680}
              height={120}
              className="music-viz-canvas"
            />
          </div>

          {/* ── Bottom panel ── */}
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
