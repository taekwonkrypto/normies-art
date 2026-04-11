import { useState } from 'react'
import './App.css'

const API_BASE = 'https://api.normies.art'

function App() {
  const [inputId, setInputId] = useState('')
  const [normie, setNormie] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [effect, setEffect] = useState('original')

  const EFFECTS = [
    { id: 'original', label: 'Original', filter: 'none' },
    { id: 'invert',   label: 'Invert',   filter: 'invert(1)' },
  ]

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
          <img
            className="normie-image"
            src={`${API_BASE}/normie/${normie.id}/image.svg`}
            alt={`Normie #${normie.id}`}
            style={{ filter: EFFECTS.find(e => e.id === effect).filter }}
          />
          <div className="effects-panel">
            <span className="effects-label">Effects</span>
            <div className="effects-row">
              {EFFECTS.map(e => (
                <button
                  key={e.id}
                  className={`effect-btn${effect === e.id ? ' active' : ''}`}
                  onClick={() => setEffect(e.id)}
                >
                  {e.label}
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
