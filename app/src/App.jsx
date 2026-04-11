import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = 'https://api.normies.art'

const BASE_ON  = '48494b'
const BASE_OFF = 'e3e5e4'

const COLORWAYS = [
  { id: 'original',  label: 'Original',  on: `#${BASE_ON}`,  off: `#${BASE_OFF}` },
  { id: 'invert',    label: 'Invert',    on: `#${BASE_OFF}`, off: `#${BASE_ON}`  },
  { id: 'matrix',    label: 'Matrix',    on: '#00ff41',      off: '#0d0d0d'      },
  { id: 'sunset',    label: 'Sunset',    on: '#ff6b35',      off: '#1a0a00'      },
  { id: 'arctic',    label: 'Arctic',    on: '#a8d8ea',      off: '#1c2b3a'      },
  { id: 'gold',      label: 'Gold',      on: '#ffd700',      off: '#1a1200'      },
  { id: 'crimson',   label: 'Crimson',   on: '#dc143c',      off: '#0f0000'      },
  { id: 'vaporwave', label: 'Vaporwave', on: '#ff71ce',      off: '#01cdfe'      },
  { id: 'ghost',     label: 'Ghost',     on: '#ffffff',      off: '#111111'      },
]

function applyColorway(svgText, cw) {
  const regex = new RegExp(`#(${BASE_ON}|${BASE_OFF})`, 'gi')
  return svgText.replace(regex, (match, hex) => {
    if (hex.toLowerCase() === BASE_ON)  return cw.on
    if (hex.toLowerCase() === BASE_OFF) return cw.off
    return match
  })
}

function App() {
  const [inputId, setInputId]     = useState('')
  const [normie, setNormie]       = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [colorway, setColorway]   = useState('original')
  const [svgText, setSvgText]     = useState(null)
  const [svgBlobUrl, setSvgBlobUrl] = useState(null)

  useEffect(() => {
    if (!normie) {
      setSvgText(null)
      return
    }
    const controller = new AbortController()
    fetch(`${API_BASE}/normie/${normie.id}/image.svg`, { signal: controller.signal })
      .then(r => r.text())
      .then(text => setSvgText(text))
      .catch(err => { if (err.name !== 'AbortError') setSvgText(null) })
    return () => controller.abort()
  }, [normie?.id])

  useEffect(() => {
    if (!svgText) {
      setSvgBlobUrl(null)
      return
    }
    const cw = COLORWAYS.find(c => c.id === colorway)
    const modified = applyColorway(svgText, cw)
    const blob = new Blob([modified], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    setSvgBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [svgText, colorway])

  async function loadNormie() {
    const id = parseInt(inputId, 10)
    if (isNaN(id) || id < 0 || id > 9999) {
      setError('Please enter a valid token ID between 0 and 9999.')
      setNormie(null)
      return
    }

    setLoading(true)
    setError(null)
    setNormie(null)
    setColorway('original')

    try {
      const res = await fetch(`${API_BASE}/normie/${id}/traits`)
      if (!res.ok) {
        throw new Error(`Token #${id} not found (${res.status})`)
      }
      const data = await res.json()
      const traits = data.attributes ?? data
      setNormie({ id, traits })
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') loadNormie()
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Normies Art Tools</h1>
        <p className="subtitle">Enter a Normie token ID to get started</p>
      </header>

      <div className="input-row">
        <input
          className="token-input"
          type="number"
          min="0"
          max="9999"
          placeholder="Token ID (0–9999)"
          value={inputId}
          onChange={(e) => setInputId(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="load-btn" onClick={loadNormie} disabled={loading}>
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

      {normie && !loading && (
        <div className="normie-card">
          <h2 className="normie-title">Normie #{normie.id}</h2>
          {svgBlobUrl && (
            <img
              className="normie-image"
              src={svgBlobUrl}
              alt={`Normie #${normie.id}`}
            />
          )}
          <div className="effects-panel">
            <span className="effects-label">Effects</span>
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
          </div>
          <div className="traits">
            {Array.isArray(normie.traits)
              ? normie.traits.map((trait, i) => (
                  <div className="trait" key={i}>
                    <span className="trait-type">{trait.trait_type}</span>
                    <span className="trait-value">{trait.value}</span>
                  </div>
                ))
              : Object.entries(normie.traits).map(([key, val]) => (
                  <div className="trait" key={key}>
                    <span className="trait-type">{key}</span>
                    <span className="trait-value">{String(val)}</span>
                  </div>
                ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
