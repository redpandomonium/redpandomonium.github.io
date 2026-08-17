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

// The lowest education tier an employer is hiring at -- deliberately lowest, not
// most common, so one reachable opening is not hidden behind nine that are not.
// Populated by apply_education_to_map.py; absent until that has been run.
// "Unclassified" (has open jobs, none labelled yet) is deliberately last and
// styled differently below -- it is a pipeline gap, not a fourth rung on the
// no-degree -> degree scale the other three represent.
const EDU_ORDER = ['No degree required', 'Training or certificate', 'College degree', 'Unclassified']
const EDU_META = {
  'No degree required': { hint: 'Hiring for at least one role needing no diploma or certificate' },
  'Training or certificate': { hint: 'Lowest opening needs a certificate, licence or trade credential' },
  'College degree': { hint: 'All current openings ask for a degree' },
  'Unclassified': { hint: 'Has open jobs, but none have an education label yet' },
}
const eduClass = (tier) => 'edu-' + tier.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')
const educationOf = (properties) => properties.lowest_education || null

// Fill weight steps down as you move away from Southwest Detroit.
const ZONE_STYLE = {
  'Southwest Detroit': { fillOpacity: 0.9, weight: 1, dash: null },
  'Around Southwest Detroit': { fillOpacity: 0.55, weight: 1, dash: null },
  'Detroit': { fillOpacity: 0.2, weight: 1.5, dash: null },
  'Outside the area': { fillOpacity: 0, weight: 1.5, dash: '3 3' },
}

const EmployerMarker = memo(function EmployerMarker({ lat, lng, company, full_address, category, sub_category, open_job_count, zone, education, isActive, onSelect }) {
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
        {education && <>{education}<br /></>}
        <em>{zone}</em>
      </Tooltip>
    </CircleMarker>
  )
})

// Collapsed by default -- three filter panels were pushing the actual employer
// listings below the fold. `defaultOpen` only seeds the initial state; each
// section remembers its own open/closed after that.
function FilterSection({ title, activeCount, totalCount, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="filter-section">
      <button
        type="button"
        className="filter-section-header"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={`chevron${open ? ' open' : ''}`}>&#9656;</span>
        <span className="filter-section-title">{title}</span>
        {activeCount < totalCount && (
          <span className="filter-section-badge">{activeCount}/{totalCount} shown</span>
        )}
      </button>
      {open && <div className="filter-section-body">{children}</div>}
    </div>
  )
}

function ZoneFilter({ counts, hiddenZones, onToggle }) {
  const total = ZONE_ORDER.filter(z => counts[z]).length
  const active = total - hiddenZones.size
  return (
    <FilterSection title="Area" activeCount={active} totalCount={total}>
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
    </FilterSection>
  )
}

// Renders nothing until the education pipeline has been run, so the map is
// never showing an empty filter for data that does not exist yet.
function EducationFilter({ counts, hiddenEducation, onToggle }) {
  const present = EDU_ORDER.filter(tier => counts[tier])
  if (!present.length) return null
  const active = present.length - hiddenEducation.size
  return (
    <FilterSection title="Education Level" activeCount={active} totalCount={present.length}>
      {present.map(tier => {
        const isActive = !hiddenEducation.has(tier)
        return (
          <button
            key={tier}
            type="button"
            className={`scope-item ${eduClass(tier)}${isActive ? '' : ' inactive'}`}
            onClick={() => onToggle(tier)}
            title={EDU_META[tier].hint}
          >
            {tier === 'Unclassified' ? (
              <span className="unclassified-marker">?</span>
            ) : (
              <span className="edu-bar" />
            )}
            <span className="scope-label">{tier}</span>
            <span className="scope-count">{counts[tier]}</span>
          </button>
        )
      })}
    </FilterSection>
  )
}

// The legend lists only categories actually present in the data, so an empty
// bucket disappears on its own -- and reappears if a future scrape reintroduces
// one -- without anyone editing this file.
function CategoryLegend({ categories, counts, hiddenCategories, onToggle }) {
  const active = categories.length - hiddenCategories.size
  return (
    <FilterSection title="Category" activeCount={active} totalCount={categories.length}>
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
    </FilterSection>
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
  const [hiddenEducation, setHiddenEducation] = useState(() => new Set())
  // Which individual job rows have their requirements snippet expanded,
  // keyed "company#index". Only jobs with a real fetched description ever
  // get a key added here -- see hasDesc in the employer-list render below.
  const [expandedJobs, setExpandedJobs] = useState(() => new Set())
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

  const educationCounts = useMemo(() => {
    const counts = {}
    for (const feature of employers) {
      const tier = educationOf(feature.properties)
      if (tier) counts[tier] = (counts[tier] || 0) + 1
    }
    return counts
  }, [employers])

  const visibleEmployers = useMemo(
    () => employers.filter(feature =>
      !hiddenCategories.has(categoryOf(feature.properties)) &&
      !hiddenZones.has(zoneOf(feature.properties)) &&
      // An employer with no education data is never filtered out by it.
      !(educationOf(feature.properties) &&
        hiddenEducation.has(educationOf(feature.properties)))
    ),
    [employers, hiddenCategories, hiddenZones, hiddenEducation]
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

  const toggleEducation = (tier) => {
    setHiddenEducation(prev => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier)
      else next.add(tier)
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

  const toggleJob = (jobKey) => {
    setExpandedJobs(prev => {
      const next = new Set(prev)
      if (next.has(jobKey)) next.delete(jobKey)
      else next.add(jobKey)
      return next
    })
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
                education={educationOf(feature.properties)}
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
        <EducationFilter
          counts={educationCounts}
          hiddenEducation={hiddenEducation}
          onToggle={toggleEducation}
        />
        <ZoneFilter counts={zoneCounts} hiddenZones={hiddenZones} onToggle={toggleZone} />
        <CategoryLegend
          categories={presentCategories}
          counts={categoryCounts}
          hiddenCategories={hiddenCategories}
          onToggle={toggleCategory}
        />
        <div className="employer-list">
          {visibleEmployers.map((feature, i) => {
            const {
              company, category, sub_category, open_job_count,
              job_titles, apply_urls, job_educations, job_descriptions,
            } = feature.properties
            const isActive = selected?.id === company
            const zone = zoneOf(feature.properties)
            // Not filtered -- job_educations/job_descriptions are index-aligned
            // with job_titles/apply_urls (guaranteed by apply_education_to_map.py
            // building all four from one pass), so dropping empty titles here
            // would shift every array out of sync with the one before it.
            const titles = job_titles ? job_titles.split(' | ') : []
            const urls = apply_urls ? apply_urls.split(' | ') : []
            const educations = job_educations ? job_educations.split(' | ') : []
            const descriptions = job_descriptions ? job_descriptions.split(' | ') : []
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
                {educationOf(feature.properties) && (
                  <span
                    className={`edu-badge ${eduClass(educationOf(feature.properties))}`}
                    title={feature.properties.education_confidence || ''}
                  >
                    {educationOf(feature.properties)}
                  </span>
                )}
                {isActive && titles.length > 0 && (
                  <ul className="job-titles-list">
                    {titles.map((title, j) => {
                      const url = urls[j]
                      const hasRealUrl = url && /^https?:\/\//.test(url)
                      const tier = educations[j]
                      const description = descriptions[j]
                      // Only jobs fetch_job_descriptions.py actually fetched and
                      // classify_education.py read carry a non-empty snippet --
                      // see FETCHED_BASES in apply_education_to_map.py. A
                      // title-only job gets no expand affordance at all, rather
                      // than one that opens onto nothing.
                      const hasDescription = Boolean(description)
                      const jobKey = `${company}#${j}`
                      const isOpen = expandedJobs.has(jobKey)
                      return (
                        <li key={j}>
                          {/* Clicking the row (title, badge, whitespace) toggles the
                              description. Opening the actual posting is a separate,
                              explicit "Apply" link so the two actions never collide
                              on the same click target. */}
                          <div
                            className={`job-title-row${hasDescription ? ' expandable' : ''}`}
                            onClick={hasDescription ? (e) => { e.stopPropagation(); toggleJob(jobKey) } : undefined}
                          >
                            {hasDescription && (
                              <span className={`job-desc-toggle${isOpen ? ' open' : ''}`}>&#9656;</span>
                            )}
                            <span className="job-title-text">{title}</span>
                            {tier && (
                              <span className={`job-edu-badge ${eduClass(tier)}`}>{tier}</span>
                            )}
                            {hasRealUrl && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="job-apply-link"
                                title="Open this posting"
                                onClick={e => e.stopPropagation()}
                              >
                                Apply&nbsp;&#8599;
                              </a>
                            )}
                          </div>
                          {hasDescription && isOpen && (
                            <div className="job-description" onClick={e => e.stopPropagation()}>
                              {description}
                            </div>
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
