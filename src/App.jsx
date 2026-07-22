import { memo, useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import { CATEGORY_COLORS, colorForCategory } from './categoryColors'
import './App.css'

const EmployerMarker = memo(function EmployerMarker({ lat, lng, company, full_address, category, sub_category, open_job_count, isActive, onSelect }) {
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={isActive ? 11 : 8}
      pathOptions={{
        color: isActive ? '#fff' : 'rgba(0, 0, 0, 0.35)',
        fillColor: colorForCategory(category),
        fillOpacity: isActive ? 1 : 0.85,
        weight: isActive ? 2 : 1,
      }}
      eventHandlers={{ click: onSelect }}
    >
      <Tooltip>
        <strong>{company}</strong><br />
        {full_address}<br />
        {category}{sub_category ? ` · ${sub_category}` : ''}<br />
        {open_job_count} open job{open_job_count !== 1 ? 's' : ''}
      </Tooltip>
    </CircleMarker>
  )
})

function CategoryLegend({ counts, activeCategories, onToggle }) {
  return (
    <div className="category-legend">
      {Object.keys(CATEGORY_COLORS).map(category => {
        const isActive = activeCategories.has(category)
        return (
          <button
            key={category}
            type="button"
            className={`legend-item${isActive ? '' : ' inactive'}`}
            onClick={() => onToggle(category)}
          >
            <span className="category-swatch" style={{ backgroundColor: CATEGORY_COLORS[category] }} />
            <span className="legend-label">{category}</span>
            <span className="legend-count">{counts[category] || 0}</span>
          </button>
        )
      })}
    </div>
  )
}

function FlyToTarget({ target }) {
  const map = useMap()
  const prevTarget = useRef(null)

  useEffect(() => {
    if (target && target !== prevTarget.current) {
      prevTarget.current = target
      map.flyTo([target.lat, target.lng], 15, { duration: 1.2 })
    }
  }, [target, map])

  return null
}

function App() {
  const [employers, setEmployers] = useState([])
  const [selected, setSelected] = useState(null)
  const [activeCategories, setActiveCategories] = useState(() => new Set(Object.keys(CATEGORY_COLORS)))
  const itemRefs = useRef({})

  useEffect(() => {
    fetch('/employers_geocoded.geojson')
      .then(res => res.json())
      .then(data => setEmployers(data.features))
  }, [])

  useEffect(() => {
    if (selected) {
      itemRefs.current[selected.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selected])

  const categoryCounts = useMemo(() => {
    const counts = {}
    for (const feature of employers) {
      const category = feature.properties.category || 'Needs Review'
      counts[category] = (counts[category] || 0) + 1
    }
    return counts
  }, [employers])

  const visibleEmployers = useMemo(
    () => employers.filter(feature => activeCategories.has(feature.properties.category || 'Needs Review')),
    [employers, activeCategories]
  )

  const toggleCategory = (category) => {
    setActiveCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const handleSelect = (feature) => {
    const [lng, lat] = feature.geometry.coordinates
    setSelected({ lat, lng, id: feature.properties.company })
  }

  return (
    <div className="app-container">
      <div className="map-wrapper">
        <img src="/Small signature logo.png" alt="Logo" className="logo-overlay" />
        <MapContainer
          center={[42.2955, -83.1114]}
          zoom={11}
          minZoom={10}
          maxBounds={[[41.95, -84.0], [42.8, -82.65]]}
          maxBoundsViscosity={1.0}
          zoomControl={false}
          style={{ height: '100%', width: '100%' }}
        >
          <ZoomControl position="bottomright" />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
          />
          <FlyToTarget target={selected} />
          {visibleEmployers.map((feature, i) => {
            const [lng, lat] = feature.geometry.coordinates
            const { company, full_address, category, sub_category, open_job_count } = feature.properties
            return (
              <EmployerMarker
                key={i}
                lat={lat}
                lng={lng}
                company={company}
                full_address={full_address}
                category={category}
                sub_category={sub_category}
                open_job_count={open_job_count}
                isActive={selected?.id === company}
                onSelect={() => handleSelect(feature)}
              />
            )
          })}
        </MapContainer>
      </div>

      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Employers</h2>
          <p>{visibleEmployers.length} locations</p>
        </div>
        <CategoryLegend counts={categoryCounts} activeCategories={activeCategories} onToggle={toggleCategory} />
        <div className="employer-list">
          {visibleEmployers.map((feature, i) => {
            const { company, category, sub_category, open_job_count, job_titles } = feature.properties
            const isActive = selected?.id === company
            const titles = job_titles ? job_titles.split(' | ').filter(Boolean) : []
            return (
              <div
                key={i}
                ref={el => { itemRefs.current[company] = el }}
                className={`employer-item${isActive ? ' active' : ''}`}
                onClick={() => handleSelect(feature)}
              >
                <div className="company-name">{company}</div>
                <div className="category-line">
                  <span className="category-swatch" style={{ backgroundColor: colorForCategory(category) }} />
                  {category || 'Needs Review'}
                </div>
                {sub_category && <div className="sub-category-line">{sub_category}</div>}
                <span className={`job-badge${open_job_count === 0 ? ' no-jobs' : ''}`}>
                  {open_job_count} open job{open_job_count !== 1 ? 's' : ''}
                </span>
                {isActive && titles.length > 0 && (
                  <ul className="job-titles-list">
                    {titles.map((title, j) => (
                      <li key={j}>{title}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default App
