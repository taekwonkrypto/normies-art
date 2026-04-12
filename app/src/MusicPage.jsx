import { useState, useEffect, useRef } from 'react'
import './MusicPage.css'

const API_BASE = 'https://api.normies.art'
const STEPS = 16
const LOOKAHEAD = 0.1
const SCHED_INTERVAL = 25

const DRUM_TYPES = ['kick', 'snare', 'hh', 'open', 'clap', 'rim', 'tomH', 'tomL']
const DRUM_LABELS = { kick: 'KICK', snare: 'SNARE', hh: 'HH', open: 'OPEN', clap: 'CLAP', rim: 'RIM', tomH: 'TOM H', tomL: 'TOM L' }

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

// ── Pixel analysis ──────────────────────────────────────────────────────────

function parseGrid(str) {
  const g = []
  for (let r = 0; r < 40; r++) {
    const row = []
    for (let c = 0; c < 40; c++) row.push(str[r * 40 + c] === '1')
    g.push(row)
  }
  return g
}

function analyzeRegion(grid, rowStart, rowEnd) {
  let total = 0, on = 0, leftOn = 0, rightOn = 0
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = 0; c < 40; c++) {
      total++
      if (grid[r][c]) { on++; if (c < 20) leftOn++; else rightOn++ }
    }
  }
  const half = total / 2
  return { density: on / total, leftDensity: leftOn / half, rightDensity: rightOn / half }
}

function analyzeGrid(grid) {
  return {
    TOP:       analyzeRegion(grid, 0, 10),
    UPPER_MID: analyzeRegion(grid, 11, 18),
    MID:       analyzeRegion(grid, 19, 26),
    LOWER:     analyzeRegion(grid, 27, 34),
    BOTTOM:    analyzeRegion(grid, 35, 39),
  }
}

// ── Trait parsing ───────────────────────────────────────────────────────────

function getTraitMap(attributes) {
  const map = {}
  if (Array.isArray(attributes)) {
    attributes.forEach(t => { map[String(t.trait_type ?? '').toLowerCase()] = String(t.value ?? '').toLowerCase() })
  }
  return map
}

function getMusicParams(traitMap) {
  const type = traitMap['type'] || ''
  let waveform = 'sine'
  if (type.includes('cat')) waveform = 'triangle'
  else if (type.includes('alien')) waveform = 'sawtooth'
  else if (type.includes('agent')) waveform = 'square'

  const expr = traitMap['expression'] || ''
  let bpm = 95
  if      (expr.includes('slight smile')) bpm = 110
  else if (expr.includes('big smile'))    bpm = 128
  else if (expr.includes('serious'))      bpm = 80
  else if (expr.includes('sad'))          bpm = 65
  else if (expr.includes('angry'))        bpm = 150
  else if (expr.includes('surprised'))    bpm = 140

  const age = traitMap['age'] || ''
  let octaveBase = 4
  if      (age.includes('young')) octaveBase = 5
  else if (age.includes('old'))   octaveBase = 3

  const eyes = traitMap['eyes'] || ''
  const hasChorus = eyes.includes('shade') || eyes.includes('sunglass')
  const isLegato  = eyes.includes('glass')

  const acc = traitMap['accessory'] || ''
  const reverbDecay = (acc.includes('hat') || acc.includes('cap') || acc.includes('beanie') || acc.includes('crown')) ? 0.8 : 0.3

  const gender = (traitMap['gender'] || '')
  let scale = 'pentatonic'
  if (gender.includes('non') || gender.includes('enby') || gender.includes('non-binary')) scale = 'wholetone'
  else if (!gender.includes('female') && !gender.includes('woman')) scale = 'pentatonic7'

  return { waveform, bpm, octaveBase, hasChorus, isLegato, reverbDecay, scale }
}

// ── Scale building ──────────────────────────────────────────────────────────

function buildScaleNotes(scale, octaveBase) {
  const config = {
    pentatonic:  { intervals: [0, 2, 4, 7, 9],     names: ['C', 'D', 'E', 'G', 'A'] },
    pentatonic7: { intervals: [0, 2, 4, 7, 9, 10], names: ['C', 'D', 'E', 'G', 'A', 'Bb'] },
    wholetone:   { intervals: [0, 2, 4, 6, 8, 10], names: ['C', 'D', 'E', 'F#', 'Ab', 'Bb'] },
  }
  const { intervals, names } = config[scale] || config.pentatonic
  const notes = []
  for (let oct = octaveBase; oct <= octaveBase + 1; oct++) {
    for (let i = 0; i < intervals.length; i++) {
      const midi = 12 * (oct + 1) + intervals[i]
      notes.push({ freq: 440 * Math.pow(2, (midi - 69) / 12), name: `${names[i]}${oct}` })
      if (notes.length >= 16) return notes
    }
  }
  return notes
}

// ── Melody generation ───────────────────────────────────────────────────────

function generateMelody(grid, regions, params) {
  const { UPPER_MID, MID } = regions
  const scaleNotes = buildScaleNotes(params.scale, params.octaveBase)
  const melody = new Array(STEPS).fill(null)

  const targetNoteCount = Math.round(4 + UPPER_MID.density * 10)
  const imbalance = MID.leftDensity - MID.rightDensity

  const stepData = []
  for (let step = 0; step < STEPS; step++) {
    const colStart = Math.floor(step * 40 / STEPS)
    const colEnd   = Math.floor((step + 1) * 40 / STEPS)
    let totalOn = 0
    let weightedRow = 0
    for (let c = colStart; c < colEnd; c++) {
      for (let r = 0; r < 40; r++) {
        if (grid[r][c]) { totalOn++; weightedRow += r }
      }
    }
    if (totalOn > 0) weightedRow /= totalOn
    const colTotal = (colEnd - colStart) * 40
    const density = totalOn / colTotal
    stepData.push({ totalOn, weightedRow, density })
  }

  const noteSteps = stepData
    .map((d, i) => ({ ...d, step: i }))
    .filter(d => d.totalOn > 0)
    .sort((a, b) => b.density - a.density)
    .slice(0, targetNoteCount)
    .map(d => d.step)

  for (const step of noteSteps) {
    const { weightedRow, density } = stepData[step]
    let t = weightedRow / 39
    if (imbalance < -0.15) t = 1 - t
    const noteIdx = Math.round(t * (scaleNotes.length - 1))
    const clamped = Math.max(0, Math.min(scaleNotes.length - 1, noteIdx))
    const velocity = 0.3 + density * 0.7
    melody[step] = { ...scaleNotes[clamped], velocity }
  }

  return melody
}

// ── Drum generation ─────────────────────────────────────────────────────────

function generateDrums(regions) {
  const { TOP, UPPER_MID, MID, LOWER, BOTTOM } = regions
  const mk = (vel = 1) => Array.from({ length: STEPS }, () => ({ active: false, velocity: vel }))
  const drums = {
    kick:  mk(1.0), snare: mk(0.85), hh: mk(0.6),  open: mk(0.55),
    clap:  mk(0.8), rim:   mk(0.5),  tomH: mk(0.75), tomL: mk(0.8),
  }

  drums.kick[0].active = true
  drums.kick[8].active = true
  if (LOWER.density > 0.4)  drums.kick[12].active = true
  if (BOTTOM.density > 0.5) drums.kick[4].active  = true

  drums.snare[4].active  = true
  drums.snare[12].active = true
  const lowerImb = LOWER.leftDensity - LOWER.rightDensity
  if (Math.abs(lowerImb) > 0.2) {
    const ghostStep = lowerImb > 0 ? 2 : 14
    drums.snare[ghostStep].active   = true
    drums.snare[ghostStep].velocity = 0.2
  }

  const hhStep = UPPER_MID.density > 0.6 ? 1 : UPPER_MID.density > 0.3 ? 2 : 4
  for (let s = 0; s < STEPS; s += hhStep) drums.hh[s].active = true
  if (drums.hh[6])  { drums.hh[6].active  = true; drums.open[6].active  = true }
  if (drums.hh[14]) { drums.hh[14].active = true; drums.open[14].active = true }

  if (TOP.density > 0.5) {
    drums.clap[4].active  = true
    drums.clap[12].active = true
  }

  if (Math.abs(MID.leftDensity - MID.rightDensity) > 0.3) {
    drums.tomH[14].active = true
    drums.tomL[15].active = true
  }

  const overall = (TOP.density + UPPER_MID.density + MID.density + LOWER.density + BOTTOM.density) / 5
  if (overall > 0.5) {
    drums.rim[2].active  = true
    drums.rim[10].active = true
  }

  return drums
}

// ── Audio synthesis ─────────────────────────────────────────────────────────

function createImpulse(ctx, decay) {
  const len = Math.floor(ctx.sampleRate * decay)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
  }
  return buf
}

function synthKick(ctx, t0, dest) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(160, t0)
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.35)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(1.0, t0 + 0.001)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35)
  osc.connect(g); g.connect(dest)
  osc.start(t0); osc.stop(t0 + 0.4)
}

function synthSnare(ctx, t0, dest) {
  const osc = ctx.createOscillator()
  osc.frequency.value = 200
  const og = ctx.createGain()
  og.gain.setValueAtTime(0.5, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1)
  osc.connect(og); og.connect(dest); osc.start(t0); osc.stop(t0 + 0.1)

  const dur = 0.15
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = buf
  const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 1500; bpf.Q.value = 0.5
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.7, t0); ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  noise.connect(bpf); bpf.connect(ng); ng.connect(dest); noise.start(t0); noise.stop(t0 + dur)
}

function synthHihat(ctx, t0, dest, open = false) {
  const dur = open ? 0.25 : 0.04
  const hpFreq = open ? 6000 : 8000
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (dur + 0.01)), ctx.sampleRate)
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = buf
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = hpFreq
  const g = ctx.createGain()
  g.gain.setValueAtTime(open ? 0.35 : 0.3, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  noise.connect(hpf); hpf.connect(g); g.connect(dest); noise.start(t0); noise.stop(t0 + dur + 0.01)
}

function synthClap(ctx, t0, dest) {
  ;[0, 0.008, 0.016].forEach(offset => {
    const dur = 0.05
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource(); noise.buffer = buf
    const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 1200; bpf.Q.value = 1
    const g = ctx.createGain(); const t = t0 + offset
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    noise.connect(bpf); bpf.connect(g); g.connect(dest); noise.start(t); noise.stop(t + dur)
  })
}

function synthRim(ctx, t0, dest) {
  const osc = ctx.createOscillator(); osc.frequency.value = 1800
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.7, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04)
  osc.connect(g); g.connect(dest); osc.start(t0); osc.stop(t0 + 0.05)
}

function synthTom(ctx, t0, dest, startHz, endHz, dur) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(startHz, t0); osc.frequency.exponentialRampToValueAtTime(endHz, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.85, t0 + 0.002)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  osc.connect(g); g.connect(dest); osc.start(t0); osc.stop(t0 + dur + 0.05)
}

// ── WAV encoding ────────────────────────────────────────────────────────────

function encodeWav(ab) {
  const nCh = ab.numberOfChannels, sr = ab.sampleRate, len = ab.length
  const blockAlign = nCh * 2, dataSize = len * blockAlign
  const buf = new ArrayBuffer(44 + dataSize); const v = new DataView(buf)
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true)
  ws(8, 'WAVE'); ws(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, nCh, true); v.setUint32(24, sr, true)
  v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true)
  ws(36, 'data'); v.setUint32(40, dataSize, true)
  let off = 44
  for (let i = 0; i < len; i++) for (let ch = 0; ch < nCh; ch++) {
    const s = Math.max(-1, Math.min(1, ab.getChannelData(ch)[i]))
    v.setInt16(off, s < 0 ? s * 32768 : s * 32767, true); off += 2
  }
  return new Blob([buf], { type: 'audio/wav' })
}

// ── Component ───────────────────────────────────────────────────────────────

export default function MusicPage({ sharedId = null, onIdLoad } = {}) {
  // State
  const [inputId,     setInputId]     = useState('')
  const [normieData,  setNormieData]  = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)

  const [melodySteps, setMelodySteps] = useState(null)
  const [drumPattern, setDrumPattern] = useState(null)

  const [playing,     setPlaying]     = useState(false)
  const [looping,     setLooping]     = useState(true)
  const [currentBeat, setCurrentBeat] = useState(-1)

  const [bpm,         setBpm]         = useState(120)
  const [bpmDraft,    setBpmDraft]    = useState('120')
  const [swing,       setSwing]       = useState(0.2)

  const [colorway,    setColorway]    = useState('original')
  const [vizMode,     setVizMode]     = useState('WAVEFORM')

  const [exporting,   setExporting]   = useState(false)
  const [audioReady,  setAudioReady]  = useState(false)

  // Audio refs
  const audioCtxRef    = useRef(null)
  const analyserRef    = useRef(null)
  const masterGainRef  = useRef(null)
  const compressorRef  = useRef(null)
  const convolverRef   = useRef(null)

  // Scheduler refs (always current, no stale closure)
  const bpmRef         = useRef(120)
  const swingRef       = useRef(0.2)
  const loopingRef     = useRef(true)
  const playingRef     = useRef(false)
  const melodyRef      = useRef(null)
  const drumRef        = useRef(null)
  const paramsRef      = useRef(null)

  const nextStepTimeRef = useRef(0)
  const currStepRef     = useRef(0)
  const scheduledRef    = useRef([])
  const intervalRef     = useRef(null)
  const rafRef          = useRef(null)

  const vizCanvasRef   = useRef(null)

  // Sync refs to state
  useEffect(() => { bpmRef.current = bpm }, [bpm])
  useEffect(() => { swingRef.current = swing }, [swing])
  useEffect(() => { loopingRef.current = looping }, [looping])
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { melodyRef.current = melodySteps }, [melodySteps])
  useEffect(() => { drumRef.current = drumPattern }, [drumPattern])

  // ── Audio setup ───────────────────────────────────────────────────────────

  function ensureAudioCtx() {
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
      return audioCtxRef.current
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    audioCtxRef.current = ctx

    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -3; compressor.knee.value = 3
    compressor.ratio.value = 20; compressor.attack.value = 0.001; compressor.release.value = 0.1
    compressorRef.current = compressor

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.85
    analyserRef.current = analyser

    const masterGain = ctx.createGain(); masterGain.gain.value = 0.7
    masterGainRef.current = masterGain

    masterGain.connect(compressor); compressor.connect(analyser); analyser.connect(ctx.destination)

    setAudioReady(true)
    return ctx
  }

  function ensureConvolver(ctx, decay) {
    if (!convolverRef.current) {
      const conv = ctx.createConvolver()
      conv.buffer = createImpulse(ctx, decay)
      conv.connect(masterGainRef.current)
      convolverRef.current = conv
    }
    return convolverRef.current
  }

  // ── Note scheduling ───────────────────────────────────────────────────────

  function scheduleMelodyNote(ctx, note, t0, noteDur) {
    const params = paramsRef.current
    if (!params) return
    const conv = ensureConvolver(ctx, params.reverbDecay)
    const releaseTime = params.isLegato ? 0.3 : 0.15
    const pk = 0.07 * note.velocity

    function makeOsc(detuneVal) {
      const osc = ctx.createOscillator()
      osc.type = params.waveform
      osc.frequency.value = note.freq
      if (detuneVal) osc.detune.value = detuneVal
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(pk, t0 + 0.01)
      g.gain.linearRampToValueAtTime(pk * 0.6, t0 + 0.09)
      g.gain.setValueAtTime(pk * 0.6, t0 + noteDur)
      g.gain.linearRampToValueAtTime(0, t0 + noteDur + releaseTime)
      osc.connect(g); g.connect(conv)
      osc.start(t0); osc.stop(t0 + noteDur + releaseTime + 0.1)
    }

    if (params.hasChorus) { makeOsc(-10); makeOsc(10) }
    else makeOsc(0)
  }

  function scheduleDrumStep(ctx, step, t0) {
    const drums = drumRef.current
    if (!drums) return
    const dest = masterGainRef.current
    if (drums.kick[step].active)  synthKick(ctx, t0, dest)
    if (drums.snare[step].active) synthSnare(ctx, t0, dest)
    if (drums.hh[step].active)    synthHihat(ctx, t0, dest, false)
    if (drums.open[step].active)  synthHihat(ctx, t0, dest, true)
    if (drums.clap[step].active)  synthClap(ctx, t0, dest)
    if (drums.rim[step].active)   synthRim(ctx, t0, dest)
    if (drums.tomH[step].active)  synthTom(ctx, t0, dest, 110, 55, 0.25)
    if (drums.tomL[step].active)  synthTom(ctx, t0, dest, 80, 35, 0.4)
  }

  function scheduleNote(ctx, step, t0) {
    const s16 = (60 / bpmRef.current) / 4
    const noteDur = s16 * 0.85
    const melody = melodyRef.current
    if (melody && melody[step]) scheduleMelodyNote(ctx, melody[step], t0, noteDur)
    scheduleDrumStep(ctx, step, t0)
    scheduledRef.current.push({ step, time: t0 })
    if (scheduledRef.current.length > 64) scheduledRef.current.splice(0, 32)
  }

  function runScheduler() {
    const ctx = audioCtxRef.current
    if (!ctx || !playingRef.current) return
    while (nextStepTimeRef.current < ctx.currentTime + LOOKAHEAD) {
      scheduleNote(ctx, currStepRef.current, nextStepTimeRef.current)
      const s16 = (60 / bpmRef.current) / 4
      const sw = swingRef.current
      const step = currStepRef.current
      const gap = step % 2 === 0 ? s16 * (1 + 2 * sw) : s16 * (1 - 2 * sw)
      nextStepTimeRef.current += gap
      currStepRef.current++
      if (currStepRef.current >= STEPS) {
        if (loopingRef.current) {
          currStepRef.current = 0
        } else {
          playingRef.current = false
          clearInterval(intervalRef.current); intervalRef.current = null
          setTimeout(() => { setPlaying(false); setCurrentBeat(-1) }, (nextStepTimeRef.current - ctx.currentTime) * 1000 + 200)
          return
        }
      }
    }
  }

  function startPlayheadLoop() {
    let lastBeat = -1
    function frame() {
      if (!playingRef.current) return
      rafRef.current = requestAnimationFrame(frame)
      const ctx = audioCtxRef.current
      if (!ctx) return
      const now = ctx.currentTime
      let bestStep = -1, bestTime = -Infinity
      for (const e of scheduledRef.current) {
        if (e.time <= now && e.time > bestTime) { bestTime = e.time; bestStep = e.step }
      }
      if (bestStep !== lastBeat) { lastBeat = bestStep; setCurrentBeat(bestStep) }
    }
    rafRef.current = requestAnimationFrame(frame)
  }

  function startPlayback() {
    const ctx = ensureAudioCtx()
    playingRef.current = true
    currStepRef.current = 0
    nextStepTimeRef.current = ctx.currentTime + 0.05
    scheduledRef.current = []
    convolverRef.current = null
    setPlaying(true)
    runScheduler()
    intervalRef.current = setInterval(runScheduler, SCHED_INTERVAL)
    startPlayheadLoop()
  }

  function stopPlayback() {
    playingRef.current = false
    clearInterval(intervalRef.current); intervalRef.current = null
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setPlaying(false)
    setCurrentBeat(-1)
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async function loadById(id) {
    stopPlayback()
    setLoading(true); setError(null)
    try {
      const [metaRes, pixRes] = await Promise.all([
        fetch(`${API_BASE}/normie/${id}/metadata`),
        fetch(`${API_BASE}/normie/${id}/pixels`),
      ])
      if (!pixRes.ok) throw new Error(`Token #${id} not found`)
      const raw = (await pixRes.text()).trim()
      if (raw.length < 1600) throw new Error(`Pixel data unavailable for #${id}`)

      let meta = {}
      if (metaRes.ok) meta = await metaRes.json()

      const attributes = meta.attributes ?? []
      const traitMap = getTraitMap(attributes)
      const params = getMusicParams(traitMap)

      const grid = parseGrid(raw.slice(0, 1600))
      const regions = analyzeGrid(grid)
      const melody = generateMelody(grid, regions, params)
      const drums  = generateDrums(regions)

      convolverRef.current = null
      paramsRef.current = params
      setBpm(params.bpm); setBpmDraft(String(params.bpm))
      setNormieData({ id, image: meta.image || null, name: meta.name || `#${id}`, traits: attributes, params })
      setMelodySteps(melody)
      setDrumPattern(drums)
      onIdLoad?.(id)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
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
    loadById(id)
  }

  // ── WAV export ────────────────────────────────────────────────────────────

  async function exportWav() {
    if (!melodySteps || !drumPattern || !normieData) return
    setExporting(true)
    try {
      const bpmVal = bpmRef.current
      const swingVal = swingRef.current
      const params = paramsRef.current
      const LOOPS = 4
      const totalSteps = STEPS * LOOPS

      // Compute total duration
      let totalDur = 0
      for (let loop = 0; loop < LOOPS; loop++) {
        for (let step = 0; step < STEPS; step++) {
          const s16 = (60 / bpmVal) / 4
          const gap = step % 2 === 0 ? s16 * (1 + 2 * swingVal) : s16 * (1 - 2 * swingVal)
          totalDur += gap
        }
      }
      totalDur += 1.5 // tail for reverb

      const offCtx = new OfflineAudioContext(2, Math.ceil(44100 * totalDur), 44100)

      // Build audio graph
      const compressor = offCtx.createDynamicsCompressor()
      compressor.threshold.value = -3; compressor.knee.value = 3
      compressor.ratio.value = 20; compressor.attack.value = 0.001; compressor.release.value = 0.1

      const masterGain = offCtx.createGain(); masterGain.gain.value = 0.7
      masterGain.connect(compressor); compressor.connect(offCtx.destination)

      const conv = offCtx.createConvolver()
      conv.buffer = createImpulse(offCtx, params.reverbDecay)
      conv.connect(masterGain)

      let t = 0.05
      for (let globalStep = 0; globalStep < totalSteps; globalStep++) {
        const step = globalStep % STEPS
        const s16 = (60 / bpmVal) / 4
        const noteDur = s16 * 0.85

        // Melody
        if (melodySteps[step]) {
          const note = melodySteps[step]
          const releaseTime = params.isLegato ? 0.3 : 0.15
          const pk = 0.07 * note.velocity

          function makeOffOsc(detuneVal) {
            const osc = offCtx.createOscillator()
            osc.type = params.waveform
            osc.frequency.value = note.freq
            if (detuneVal) osc.detune.value = detuneVal
            const g = offCtx.createGain()
            g.gain.setValueAtTime(0, t)
            g.gain.linearRampToValueAtTime(pk, t + 0.01)
            g.gain.linearRampToValueAtTime(pk * 0.6, t + 0.09)
            g.gain.setValueAtTime(pk * 0.6, t + noteDur)
            g.gain.linearRampToValueAtTime(0, t + noteDur + releaseTime)
            osc.connect(g); g.connect(conv)
            osc.start(t); osc.stop(t + noteDur + releaseTime + 0.1)
          }

          if (params.hasChorus) { makeOffOsc(-10); makeOffOsc(10) }
          else makeOffOsc(0)
        }

        // Drums
        if (drumPattern.kick[step].active)  synthKick(offCtx, t, masterGain)
        if (drumPattern.snare[step].active) synthSnare(offCtx, t, masterGain)
        if (drumPattern.hh[step].active)    synthHihat(offCtx, t, masterGain, false)
        if (drumPattern.open[step].active)  synthHihat(offCtx, t, masterGain, true)
        if (drumPattern.clap[step].active)  synthClap(offCtx, t, masterGain)
        if (drumPattern.rim[step].active)   synthRim(offCtx, t, masterGain)
        if (drumPattern.tomH[step].active)  synthTom(offCtx, t, masterGain, 110, 55, 0.25)
        if (drumPattern.tomL[step].active)  synthTom(offCtx, t, masterGain, 80, 35, 0.4)

        const gap = step % 2 === 0 ? s16 * (1 + 2 * swingVal) : s16 * (1 - 2 * swingVal)
        t += gap
      }

      const rendered = await offCtx.startRendering()
      const blob = encodeWav(rendered)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `normie-${normieData.id}-${bpmVal}bpm.wav`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      console.error('WAV export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  // ── Visualizer ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!audioReady) return
    const canvas = vizCanvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    let rafId

    const cw = COLORWAYS.find(c => c.id === colorway) || COLORWAYS[0]

    function draw() {
      rafId = requestAnimationFrame(draw)
      const analyser = analyserRef.current
      if (!analyser) return

      const W = canvas.width
      const H = canvas.height
      const vuW = 20
      const mainW = W - vuW

      ctx2d.clearRect(0, 0, W, H)
      ctx2d.fillStyle = cw.off
      ctx2d.fillRect(0, 0, W, H)

      if (vizMode === 'WAVEFORM') {
        const bufLen = analyser.fftSize
        const data = new Float32Array(bufLen)
        analyser.getFloatTimeDomainData(data)

        const grad = ctx2d.createLinearGradient(0, 0, 0, H)
        grad.addColorStop(0, cw.on)
        grad.addColorStop(0.5, cw.off)
        grad.addColorStop(1, cw.on)

        ctx2d.beginPath()
        ctx2d.strokeStyle = grad
        ctx2d.lineWidth = 1.5
        for (let i = 0; i < mainW; i++) {
          const idx = Math.floor(i * bufLen / mainW)
          const v = data[idx] * (H / 2) * 0.9
          const y = H / 2 - v
          if (i === 0) ctx2d.moveTo(i, y)
          else ctx2d.lineTo(i, y)
        }
        ctx2d.stroke()
      } else {
        const bufLen = analyser.frequencyBinCount
        const data = new Uint8Array(bufLen)
        analyser.getByteFrequencyData(data)

        const barW = mainW / 64
        const grad = ctx2d.createLinearGradient(0, H, 0, 0)
        grad.addColorStop(0, cw.off)
        grad.addColorStop(1, cw.on)

        for (let i = 0; i < 64; i++) {
          const idx = Math.floor(i * bufLen / 64)
          const barH = (data[idx] / 255) * H
          const x = i * barW
          ctx2d.fillStyle = grad
          ctx2d.fillRect(x, H - barH, barW - 1, barH)
        }
      }

      // VU meter (right 20px)
      const vuData = new Uint8Array(analyserRef.current.frequencyBinCount)
      analyserRef.current.getByteFrequencyData(vuData)
      let rms = 0
      for (let i = 0; i < vuData.length; i++) rms += (vuData[i] / 255) * (vuData[i] / 255)
      rms = Math.sqrt(rms / vuData.length)
      const vuH = Math.min(H, rms * H * 3)

      ctx2d.fillStyle = cw.off
      ctx2d.fillRect(mainW, 0, vuW, H)
      ctx2d.fillStyle = cw.on
      ctx2d.globalAlpha = 0.7
      ctx2d.fillRect(mainW + 2, H - vuH, vuW - 4, vuH)
      ctx2d.globalAlpha = 1
    }

    draw()
    return () => cancelAnimationFrame(rafId)
  }, [audioReady, vizMode, colorway])

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearInterval(intervalRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close()
      }
    }
  }, [])

  // ── Shared ID ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (sharedId === null || normieData?.id === sharedId) return
    setInputId(String(sharedId))
    loadById(sharedId)
  }, [sharedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────

  const cw = COLORWAYS.find(c => c.id === colorway) || COLORWAYS[0]

  const BEAT_STEPS = new Set([0, 4, 8, 12])

  function nudgeBpm(delta) {
    const next = Math.max(40, Math.min(250, bpm + delta))
    setBpm(next); setBpmDraft(String(next))
  }

  function handleBpmBlur() {
    const n = parseInt(bpmDraft, 10)
    const clamped = isNaN(n) ? bpm : Math.max(40, Math.min(250, n))
    setBpm(clamped); setBpmDraft(String(clamped))
  }

  // Subset of traits to show as pills
  const PILL_KEYS = ['type', 'expression', 'age', 'eyes', 'gender', 'accessory']
  function getDisplayTraits(traits) {
    if (!Array.isArray(traits)) return []
    return traits.filter(t => PILL_KEYS.includes((t.trait_type || '').toLowerCase()))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="music-page">
      <header className="header">
        <h1 className="title">Normie Music</h1>
        <p className="subtitle">Generate algorithmic music from a Normie's pixel art and traits</p>
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
          onKeyDown={e => { if (e.key === 'Enter') handleLoad() }}
        />
        <button className="load-btn" onClick={handleLoad} disabled={loading}>
          {loading ? 'Loading…' : 'Load Normie'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <span>Fetching Normie…</span>
        </div>
      )}

      {normieData && !loading && (
        <>
          {/* Normie info */}
          <div className="normie-info">
            {normieData.image && (
              <img className="normie-thumb" src={normieData.image} alt="" />
            )}
            <div className="normie-details">
              <div className="normie-name">{normieData.name}</div>
              <div className="trait-pills">
                {getDisplayTraits(normieData.traits).map((t, i) => (
                  <span key={i} className="trait-pill">
                    {t.trait_type}: {t.value}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Transport */}
          <div className="music-transport">
            <button className="bpm-nudge" onClick={() => nudgeBpm(-5)}>−5</button>
            <input
              className="delay-input"
              type="text"
              inputMode="numeric"
              value={bpmDraft}
              onChange={e => setBpmDraft(e.target.value)}
              onBlur={handleBpmBlur}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              style={{ width: '3.5rem', textAlign: 'center' }}
            />
            <button className="bpm-nudge" onClick={() => nudgeBpm(5)}>+5</button>
            <span className="delay-unit" style={{ marginRight: 8 }}>BPM</span>

            <button
              className={`play-btn${playing ? ' active' : ''}`}
              onClick={() => playing ? stopPlayback() : startPlayback()}
              disabled={!melodySteps}
            >
              {playing ? 'Stop' : 'Play'}
            </button>

            <button
              className={`play-btn${looping ? ' active' : ''}`}
              onClick={() => setLooping(l => !l)}
            >
              {looping ? 'Loop On' : 'Loop Off'}
            </button>
          </div>

          {/* Swing */}
          <div className="music-swing-bar">
            <span className="swing-label">Swing</span>
            <input
              type="range"
              className="swing-slider"
              min="0"
              max="50"
              value={Math.round(swing * 100)}
              onChange={e => setSwing(Number(e.target.value) / 100)}
            />
            <span className="swing-val">{Math.round(swing * 100)}%</span>
          </div>

          {/* Step sequencer */}
          <div
            className="step-seq"
            style={{ '--cw-on': cw.on, '--cw-off': cw.off }}
          >
            {/* Melody section */}
            <div className="seq-section">
              <div className="seq-section-label">Melody</div>
              <div className="seq-melody-row">
                <div /> {/* empty label slot */}
                {Array.from({ length: STEPS }).map((_, i) => {
                  const note = melodySteps ? melodySteps[i] : null
                  return (
                    <div
                      key={i}
                      className={[
                        'seq-cell',
                        'melody-cell',
                        note ? 'active' : '',
                        currentBeat === i ? 'playing' : '',
                        BEAT_STEPS.has(i) ? 'beat-start' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {note && <span className="note-name">{note.name}</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Drum section */}
            <div className="seq-section">
              <div className="seq-section-label">Drums</div>
              {DRUM_TYPES.map(type => (
                <div key={type} className="drum-row">
                  <span className="drum-row-label">{DRUM_LABELS[type]}</span>
                  {drumPattern
                    ? drumPattern[type].map((cell, i) => (
                        <div
                          key={i}
                          className={[
                            'seq-cell',
                            'drum-cell',
                            cell.active ? 'active' : '',
                            currentBeat === i ? 'playing' : '',
                            BEAT_STEPS.has(i) ? 'beat-start' : '',
                          ].filter(Boolean).join(' ')}
                        />
                      ))
                    : Array.from({ length: STEPS }).map((_, i) => (
                        <div
                          key={i}
                          className={[
                            'seq-cell',
                            'drum-cell',
                            currentBeat === i ? 'playing' : '',
                            BEAT_STEPS.has(i) ? 'beat-start' : '',
                          ].filter(Boolean).join(' ')}
                        />
                      ))
                  }
                </div>
              ))}
            </div>
          </div>

          {/* Visualizer */}
          <div className="music-viz-bar">
            <div className="music-viz-btns">
              <button
                className={`effect-btn${vizMode === 'WAVEFORM' ? ' active' : ''}`}
                onClick={() => setVizMode('WAVEFORM')}
              >
                Waveform
              </button>
              <button
                className={`effect-btn${vizMode === 'FREQUENCY' ? ' active' : ''}`}
                onClick={() => setVizMode('FREQUENCY')}
              >
                Frequency
              </button>
            </div>
            {!audioReady && (
              <span className="music-hint">press play to activate</span>
            )}
          </div>

          <div className="viz-canvas-wrap">
            <canvas
              ref={vizCanvasRef}
              className="music-viz-canvas"
              width={680}
              height={120}
            />
          </div>

          {/* Colorways */}
          <div className="effects-panel music-panel">
            <span className="effects-label">Colorway</span>
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

            {/* Export */}
            <button
              className="download-btn"
              onClick={exportWav}
              disabled={exporting || !melodySteps}
            >
              {exporting ? 'Rendering 4 bars…' : 'Download WAV'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
