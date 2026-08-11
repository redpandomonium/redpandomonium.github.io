import { memo, useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import { CATEGORY_COLORS, UNCATEGORISED_LABEL, colorForCategory } from './categoryColors'
import './App.css'

// Zones are geographic, not judgements about an employer. Everything stays on
// the map; the styling just makes Southwest Detroit read first.
const ZONE_META = {
  'Southwest Detroit': { hint: 'Mexicantown, Springwells, Corktown, Boynton and Oakwood Heights' },
  'Around Southwest Detroit': { hint: 'River Rouge, Ecorse, Melvindale, Lincoln Park, Wyandotte, Riverview, Trenton and Dearborn' },
  'Detroit': { hint: 'Elsewhere in the city of Detroit' },
  'Outside the area': { hint: 'Outside Detroit and the surrounding communities' },
}
const ZONE_ORDER = ['Southwest Detroit', 'Around Southwest Detroit', 'Detroit', 'Outside the area']
const zoneOf = (properties) => (ZONE_META[properties.zone] ? properties.zone : 'Detroit')
const zoneClass = (zone) => 'zone-' + zone.toLowerCase().replace(/\s+/g, '-')
const categoryOf = (properties) => properties.category || UNCATEGORISED_LABEL

// Fill weight steps down as you move away from Southwest Detroit.
const ZONE_STYLE = {
  'Southwest Detroit': { fillOpacity: 0.9, weight: 1, dash: null },
  'Around Southwest Detroit': { fillOpacity: 0.55, weight: 1, dash: null },
  'Detroit': { fillOpacity: 0.2, weight: 1.5, dash: null },
  'Outside the area': { fillOpacity: 0, weight: 1.5, dash: '3 3' },
}

const EmployerMarker = memo(function EmployerMarker({ lat, lng, company, full_address, category, sub_category, open_job_count, zone, isActive, onSelect }) {
  const fill = colorForCategory(category)
  const style = ZONE_STYLE[zone]
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={isActive ? 11 : 8}
      pathOptions={{
        color: isActive ? '#fff' : (style.fillOpacity > 0.5 ? 'rgba(0, 0, 0, 0.35)' : fill),
        fillColor: fill,
        fillOpacity: isActive ? Math.max(style.fillOpacity, 0.6) : style.fillOpacity,
        weight: isActive ? 2 : style.weight,
        dashArray: style.dash,
      }}
      eventHandlers={{ click: onSelect }}
    >
      <Tooltip>
        <strong>{company}</strong><br />
        {full_address}<br />
        {category}{sub_category ? ` · ${sub_category}` : ''}<br />
        {open_job_count} open job{open_job_count !== 1 ? 's' : ''}<br />
        <em>{zone}</em>
      </Tooltip>
    </CircleMarker>
  )
})

function ZoneFilter({ counts, hiddenZones, onToggle }) {
  return (
    <div className="scope-filter">
      <div className="scope-filter-title">Area</div>
      {ZONE_ORDER.map(zone => {
        const isActive = !hiddenZones.has(zone)
        return (
          <button
            key={zone}
            type="button"
            className={`scope-item ${zoneClass(zone)}${isActive ? '' : ' inactive'}`}
            onClick={() => onToggle(zone)}
            title={ZONE_META[zone].hint}
          >
            <span className="scope-marker" />
            <span className="scope-label">{zone}</span>
            <span className="scope-count">{counts[zone] || 0}</span>
          </button>
        )
      })}
    </div>
  )
}

// The legend lists only categories actually present in the data, so an empty
// bucket disappears on its own -- and reappears if a future scrape reintroduces
// one -- without anyone editing this file.
function CategoryLegend({ categories, counts, hiddenCategories, onToggle }) {
  return (
    <div className="category-legend">
      {categories.map(category => {
        const isActive = !hiddenCategories.has(category)
        return (
          <button
            key={category}
            type="button"
            className={`legend-item${isActive ? '' : ' inactive'}`}
            onClick={() => onToggle(category)}
          >
            <span className="category-swatch" style={{ backgroundColor: colorForCategory(category) }} />
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
  // Tracks which categories are switched OFF rather than on. Empty means
  // everything is visible, so a category the data introduces later is shown by
  // default instead of vanishing because it was missing from a seeded list.
  const [hiddenCategories, setHiddenCategories] = useState(() => new Set())
  // Hidden-set, like categories: empty means every area is shown.
  const [hiddenZones, setHiddenZones] = useState(() => new Set())
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
      const category = categoryOf(feature.properties)
      counts[category] = (counts[category] || 0) + 1
    }
    return counts
  }, [employers])

  // Known categories first, in palette order, then any unexpected value the data
  // introduces -- so a new or blank category surfaces in the legend rather than
  // being quietly dropped.
  const presentCategories = useMemo(() => {
    const present = new Set(Object.keys(categoryCounts))
    const known = Object.keys(CATEGORY_COLORS).filter(c => present.has(c))
    const extra = [...present].filter(c => !(c in CATEGORY_COLORS)).sort()
    return [...known, ...extra]
  }, [categoryCounts])

  const zoneCounts = useMemo(() => {
    const counts = {}
    for (const feature of employers) {
      const zone = zoneOf(feature.properties)
      counts[zone] = (counts[zone] || 0) + 1
    }
    return counts
  }, [employers])

  const visibleEmployers = useMemo(
    () => employers.filter(feature =>
      !hiddenCategories.has(categoryOf(feature.properties)) &&
      !hiddenZones.has(zoneOf(feature.properties))
    ),
    [employers, hiddenCategories, hiddenZones]
  )

  const swVisible = useMemo(
    () => visibleEmployers.filter(feature => zoneOf(feature.properties) === 'Southwest Detroit').length,
    [visibleEmployers]
  )

  const toggleCategory = (category) => {
    setHiddenCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const toggleZone = (zone) => {
    setHiddenZones(prev => {
      const next = new Set(prev)
      if (next.has(zone)) next.delete(zone)
      else next.add(zone)
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
                zone={zoneOf(feature.properties)}
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
          <p>
            {visibleEmployers.length} location{visibleEmployers.length !== 1 ? 's' : ''}
            {swVisible !== visibleEmployers.length && (
              <span className="corridor-count"> · {swVisible} in Southwest Detroit</span>
            )}
          </p>
        </div>
        <ZoneFilter counts={zoneCounts} hiddenZones={hiddenZones} onToggle={toggleZone} />
        <CategoryLegend
          categories={presentCategories}
          counts={categoryCounts}
          hiddenCategories={hiddenCategories}
          onToggle={toggleCategory}
        />
        <div className="employer-list">
          {visibleEmployers.map((feature, i) => {
            const { company, category, sub_category, open_job_count, job_titles, apply_urls } = feature.properties
            const isActive = selected?.id === company
            const zone = zoneOf(feature.properties)
            const titles = job_titles ? job_titles.split(' | ').filter(Boolean) : []
            const urls = apply_urls ? apply_urls.split(' | ') : []
            return (
              <div
                key={i}
                ref={el => { itemRefs.current[company] = el }}
                className={`employer-item${isActive ? ' active' : ''}${zone !== 'Southwest Detroit' ? ' out-of-scope' : ''}`}
                onClick={() => handleSelect(feature)}
              >
                <div className="company-name">{company}</div>
                {zone !== 'Southwest Detroit' && (
                  <div className={`scope-tag ${zoneClass(zone)}`} title={ZONE_META[zone].hint}>
                    {zone}
                  </div>
                )}
                <div className="category-line">
                  <span className="category-swatch" style={{ backgroundColor: colorForCategory(category) }} />
                  {categoryOf(feature.properties)}
                </div>
                {sub_category && <div className="sub-category-line">{sub_category}</div>}
                <span className={`job-badge${open_job_count === 0 ? ' no-jobs' : ''}`}>
                  {open_job_count} open job{open_job_count !== 1 ? 's' : ''}
                </span>
                {isActive && titles.length > 0 && (
                  <ul className="job-titles-list">
                    {titles.map((title, j) => {
                      const url = urls[j]
                      const hasRealUrl = url && /^https?:\/\//.test(url)
                      return (
                        <li key={j}>
                          {hasRealUrl ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="job-title-link"
                              onClick={e => e.stopPropagation()}
                            >
                              {title}
                            </a>
                          ) : (
                            title
                          )}
                        </li>
                      )
                    })}
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
