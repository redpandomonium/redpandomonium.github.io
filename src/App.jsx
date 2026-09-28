import { memo, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import { CATEGORY_COLORS, UNCATEGORISED_LABEL, colorForCategory, TRAINING_PROVIDER_COLOR } from './categoryColors'
import useIsMobile from './useIsMobile'
import TransitLayer from './TransitLayer'
import { TRANSIT_AGENCIES, TRANSIT_ORDER } from './transitAgencies'
import FeedbackButton from './Feedback'
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

// The training-provider category values, as they exist in
// training_providers.geojson today. Hardcoded rather than derived from the
// loaded data (unlike trainingCategories in App, used only for legend
// styling) specifically so the resting-state default below can be computed
// synchronously, with no dependency on either fetch finishing -- an earlier
// version seeded hiddenCategories from an effect keyed on the loaded data,
// which raced against which of the two independent fetches (employers vs.
// training providers) resolved first and could permanently miss whichever
// category set arrived second. A hardcoded list can't race; a category
// added to the data later just isn't hidden by default until this list is
// updated to match, same as a genuinely new employer category would show up
// unhidden too (see the comment on hiddenCategories below).
const TRAINING_CATEGORIES = ['Trade/vocational school', 'Community organization', 'Community college']

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

// Great-circle distance in miles -- used by the ZIP filter to rank/limit
// employers by how far they are from the ZIP the visitor typed in.
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

const ZIP_RADIUS_OPTIONS = [5, 10, 25, 50]

// Fill weight steps down as you move away from Southwest Detroit.
const ZONE_STYLE = {
  'Southwest Detroit': { fillOpacity: 0.9, weight: 1, dash: null },
  'Around Southwest Detroit': { fillOpacity: 0.55, weight: 1, dash: null },
  'Detroit': { fillOpacity: 0.2, weight: 1.5, dash: null },
  'Outside the area': { fillOpacity: 0, weight: 1.5, dash: '3 3' },
}

// A pin, not a circle, so the two datasets are unambiguous on the map even
// before a viewer reads the legend -- see the note on TRAINING_PROVIDER_COLOR
// in categoryColors.js. Built as a function rather than a module-level
// constant because the active state needs its own (slightly larger) icon,
// and there are only ever ~16 of these markers, so recreating one on click is
// free.
function trainingIcon(isActive) {
  return L.divIcon({
    className: 'training-marker-icon',
    html: `<span class="training-marker-glyph${isActive ? ' active' : ''}" style="background:${TRAINING_PROVIDER_COLOR}">🎓</span>`,
    iconSize: isActive ? [26, 26] : [22, 22],
    iconAnchor: isActive ? [13, 13] : [11, 11],
  })
}

// Leaflet's non-permanent <Tooltip> opens on click but only closes on
// mouseout (no such event on touch), so a tap on mobile leaves it stuck open
// with nothing to dismiss it. Rather than track "which tooltip is open" and
// patch close behavior, it's suppressed entirely on mobile -- a tap already
// calls onSelect, which surfaces the same info via the sidebar's List view.
const TrainingMarker = memo(function TrainingMarker({ lat, lng, provider, address, category, credential_focus, cost_notes, isActive, isMobile, onSelect }) {
  return (
    <Marker position={[lat, lng]} icon={trainingIcon(isActive)} eventHandlers={{ click: onSelect }}>
      {!isMobile && (
        <Tooltip>
          <strong>{provider}</strong><br />
          {address}<br />
          {category}<br />
          {credential_focus}<br />
          {cost_notes && <em>{cost_notes}</em>}
        </Tooltip>
      )}
    </Marker>
  )
})

const EmployerMarker = memo(function EmployerMarker({ lat, lng, company, full_address, category, sub_category, open_job_count, zone, education, isActive, isMobile, onSelect }) {
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
      {!isMobile && (
        <Tooltip>
          <strong>{company}</strong><br />
          {full_address}<br />
          {category}{sub_category ? ` · ${sub_category}` : ''}<br />
          {open_job_count} open job{open_job_count !== 1 ? 's' : ''}<br />
          {education && <>{education}<br /></>}
          <em>{zone}</em>
        </Tooltip>
      )}
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

// Not built on FilterSection -- that component's chrome (badge, chevron,
// collapsible body of toggle buttons) doesn't fit a text input, and this is
// worth showing open by default since it's a direct search rather than a
// declutter-by-default toggle list like the others. Geocoding a full 5-digit
// ZIP happens in App itself (see the zip* state/effect there); this just
// renders whatever status that effect has reached.
function ZipFilter({ zip, onZipChange, radius, onRadiusChange, status, matchCount }) {
  return (
    <div className="filter-section zip-filter">
      <div className="zip-filter-title">Near a ZIP code</div>
      <div className="zip-filter-body">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          placeholder="e.g. 48210"
          value={zip}
          onChange={e => onZipChange(e.target.value.replace(/\D/g, '').slice(0, 5))}
          className="zip-input"
        />
        {zip.length === 5 && status !== 'error' && (
          <div className="zip-radius-row">
            {ZIP_RADIUS_OPTIONS.map(r => (
              <button
                key={r}
                type="button"
                className={`zip-radius-btn${radius === r ? ' active' : ''}`}
                onClick={() => onRadiusChange(r)}
              >
                {r} mi
              </button>
            ))}
          </div>
        )}
        {status === 'loading' && <p className="zip-status">Looking up {zip}&hellip;</p>}
        {status === 'error' && <p className="zip-status zip-error">Couldn&rsquo;t find ZIP {zip}.</p>}
        {status === 'ok' && (
          <p className="zip-status">
            {matchCount} job{matchCount !== 1 ? 's' : ''} within {radius} mi of {zip}
          </p>
        )}
      </div>
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

// An overlay, not a filter -- it adds context (can a resident get there
// without a car?) rather than narrowing the employer list, so it counts
// nothing and hides nothing. Off by default like everything else; the ~340 KB
// of route/stop data isn't even downloaded until the first agency is turned
// on (see the transit fetch effect in App).
function TransitFilter({ shownAgencies, onToggle, status }) {
  return (
    <FilterSection title="Transit" activeCount={shownAgencies.size} totalCount={TRANSIT_ORDER.length}>
      {TRANSIT_ORDER.map(agency => {
        const meta = TRANSIT_AGENCIES[agency]
        const isActive = shownAgencies.has(agency)
        return (
          <button
            key={agency}
            type="button"
            className={`scope-item${isActive ? '' : ' inactive'}`}
            onClick={() => onToggle(agency)}
            title={meta.hint}
          >
            <svg className="transit-swatch" width="18" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="18" y2="3" stroke={meta.color} strokeWidth="2" strokeDasharray={meta.dash || undefined} />
            </svg>
            <span className="scope-label">{meta.label}</span>
          </button>
        )
      })}
      {status === 'loading' && <p className="transit-note">Loading routes&hellip;</p>}
      {status === 'error' && <p className="transit-note zip-error">Couldn&rsquo;t load transit data.</p>}
      {status === 'ok' && shownAgencies.size > 0 && (
        <p className="transit-note">Zoom in close to see stops.</p>
      )}
    </FilterSection>
  )
}

// The legend lists only categories actually present in the data, so an empty
// bucket disappears on its own -- and reappears if a future scrape reintroduces
// one -- without anyone editing this file. Training-provider categories (see
// trainingCategories, derived from the data rather than hardcoded) are mixed
// into the same list rather than living behind a separate "Show" toggle --
// but they keep the amber colour and square-ish swatch used everywhere else
// for that dataset (scope-item.layer-training, .training-swatch) so they
// still read as a different kind of thing from an employer category, per the
// reasoning in categoryColors.js.
function CategoryLegend({ categories, counts, hiddenCategories, trainingCategories, onToggle, onToggleAll }) {
  const active = categories.length - hiddenCategories.size
  const allActive = active === categories.length
  return (
    <FilterSection title="Category" activeCount={active} totalCount={categories.length}>
      <button type="button" className="category-select-all" onClick={() => onToggleAll(!allActive)}>
        {allActive ? 'Clear all' : 'Select all'}
      </button>
      <div className="category-legend">
        {categories.map(category => {
          const isActive = !hiddenCategories.has(category)
          const isTraining = trainingCategories.has(category)
          return (
            <button
              key={category}
              type="button"
              className={`legend-item${isActive ? '' : ' inactive'}`}
              onClick={() => onToggle(category)}
            >
              <span
                className={`category-swatch${isTraining ? ' training-swatch' : ''}`}
                style={{ backgroundColor: isTraining ? TRAINING_PROVIDER_COLOR : colorForCategory(category) }}
              />
              <span className="legend-label">{category}</span>
              <span className="legend-count">{counts[category] || 0}</span>
            </button>
          )
        })}
      </div>
    </FilterSection>
  )
}

// `active` is false while this pane is hidden behind the mobile List/Map
// toggle (display:none via .hidden-mobile). Leaflet's flyTo animates by
// computing pixel bounds from the container's current size -- on a
// zero-size hidden container that division produces NaN and crashes the
// whole tree ("Invalid LatLng object: (NaN, NaN)"), not just a cosmetic
// glitch. So this does nothing while inactive, WITHOUT marking the target as
// handled (prevTarget stays put) -- the effect then naturally re-fires and
// catches up once the pane becomes visible again, via `active` itself being
// a dependency. invalidateSize() runs first on that same transition, since
// display:none leaves Leaflet's cached container size stale.
function FlyToTarget({ target, active }) {
  const map = useMap()
  const prevTarget = useRef(null)

  useEffect(() => {
    if (!active) return
    map.invalidateSize()
    if (target && target !== prevTarget.current) {
      prevTarget.current = target
      map.flyTo([target.lat, target.lng], 15, { duration: 1.2 })
    }
  }, [target, active, map])

  return null
}

function App() {
  const [employers, setEmployers] = useState([])
  const [trainingProviders, setTrainingProviders] = useState([])
  // { lat, lng, id, kind } -- kind distinguishes an employer's `company` from
  // a provider's `provider` name so the two id spaces can't collide, and so
  // isActive checks below (and the itemRefs key) know which list an id came
  // from.
  const [selected, setSelected] = useState(null)
  // Tracks which categories are switched OFF rather than on. Starts with
  // EVERY known category already hidden (employers via CATEGORY_COLORS,
  // training providers via TRAINING_CATEGORIES above) -- resting state is
  // nothing plotted and nothing listed, prompting a deliberate choice
  // rather than dumping 140+ pins on load. This is computed synchronously
  // from static, already-imported lists, not from the fetched data, so
  // there's no async ordering for it to race against. A category the data
  // introduces later that isn't in either list starts visible, same as
  // presentCategories below already treats an unrecognised value.
  const [hiddenCategories, setHiddenCategories] = useState(
    () => new Set([...Object.keys(CATEGORY_COLORS), ...TRAINING_CATEGORIES])
  )
  // Hidden-set, like categories: empty means every area is shown.
  const [hiddenZones, setHiddenZones] = useState(() => new Set())
  const [hiddenEducation, setHiddenEducation] = useState(() => new Set())
  // ZIP filter. zipInput is the raw text box value; zipCoords/zipStatus are
  // the raw result of the last completed geocode (see the effect below).
  // Everything downstream (visibleEmployers, the list's distance line) reads
  // the derived activeZipCoords/displayZipStatus instead (see below), not
  // these directly, so a half-typed, still-loading, or unrecognised ZIP
  // never filters anything out.
  const [zipInput, setZipInput] = useState('')
  const [zipRadius, setZipRadius] = useState(10)
  const [zipCoords, setZipCoords] = useState(null)
  const [zipStatus, setZipStatus] = useState('idle') // idle | ok | error
  // Which zip zipCoords/zipStatus actually describe -- lets the render below
  // derive a "still loading" state for a not-yet-geocoded zipInput without
  // an effect having to setState synchronously just to flip on a spinner
  // (see the effect itself: every setState there happens inside an async
  // fetch callback, never directly in the effect body).
  const [geocodedZip, setGeocodedZip] = useState(null)
  // Whether the Training Providers list (separate from the map/marker
  // visibility, which is now just another Category toggle) is expanded.
  // Defaults open -- unlike the filter panels above, this is real content
  // a viewer came here to browse, not chrome to declutter by default.
  const [trainingListOpen, setTrainingListOpen] = useState(true)
  // Which individual job rows have their requirements snippet expanded,
  // keyed "company#index". Only jobs with a real fetched description ever
  // get a key added here -- see hasDesc in the employer-list render below.
  const [expandedJobs, setExpandedJobs] = useState(() => new Set())
  const itemRefs = useRef({})
  const isMobile = useIsMobile()
  // Only meaningful when isMobile -- below 900px the map and sidebar become
  // full-screen tabs instead of a side-by-side layout. Defaults to the list
  // because browsing/filtering the ~126-row list, not the map, is the
  // primary task this app is used for.
  const [viewMode, setViewMode] = useState('list')
  // Shown-set (the reverse of the hidden-sets above) since the overlay starts
  // off: empty means no transit drawn.
  const [shownAgencies, setShownAgencies] = useState(() => new Set())
  // { routes, stops } once loaded; transitError if either file failed.
  const [transitData, setTransitData] = useState(null)
  const [transitError, setTransitError] = useState(false)
  const transitRequested = useRef(false)

  useEffect(() => {
    fetch('/employers_geocoded.geojson')
      .then(res => res.json())
      .then(data => setEmployers(data.features))
  }, [])

  useEffect(() => {
    // 404s quietly to an empty layer rather than breaking the page -- this
    // file only exists once build_training_geojson.py has been run at least
    // once (see training-providers/README.md).
    fetch('/training_providers.geojson')
      .then(res => res.ok ? res.json() : { features: [] })
      .then(data => setTrainingProviders(data.features))
      .catch(() => setTrainingProviders([]))
  }, [])

  // Deferred until the visitor first turns an agency on -- most visits never
  // touch the overlay, and it's ~4x the size of the employer data. The ref
  // (not state) makes sure toggling agencies on/off while the first request
  // is in flight doesn't start a second one.
  useEffect(() => {
    if (shownAgencies.size === 0 || transitRequested.current) return
    transitRequested.current = true
    const load = (path) => fetch(path).then(res => {
      if (!res.ok) throw new Error(`${path} ${res.status}`)
      return res.json()
    })
    Promise.all([load('/transit_routes.geojson'), load('/transit_stops.geojson')])
      .then(([routes, stops]) => setTransitData({ routes: routes.features, stops: stops.features }))
      .catch(() => setTransitError(true))
  }, [shownAgencies])

  // Geocodes zipInput once it's a complete 5-digit ZIP, via Zippopotam.us --
  // free, keyless, CORS-enabled, good enough for "which corner of metro
  // Detroit is this ZIP in". Debounced 400ms so it doesn't fire on every
  // keystroke while typing. `cancelled` guards against a stale response
  // landing after a newer ZIP has already been typed (fetches aren't
  // guaranteed to resolve in request order).
  useEffect(() => {
    if (zipInput.length !== 5) return
    let cancelled = false
    const timer = setTimeout(() => {
      fetch(`https://api.zippopotam.us/us/${zipInput}`)
        .then(res => {
          if (!res.ok) throw new Error('zip not found')
          return res.json()
        })
        .then(data => {
          if (cancelled) return
          const place = data.places?.[0]
          if (!place) throw new Error('zip not found')
          setZipCoords({ lat: parseFloat(place.latitude), lng: parseFloat(place.longitude) })
          setZipStatus('ok')
          setGeocodedZip(zipInput)
        })
        .catch(() => {
          if (cancelled) return
          setZipCoords(null)
          setZipStatus('error')
          setGeocodedZip(zipInput)
        })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [zipInput])

  useEffect(() => {
    if (selected) {
      itemRefs.current[`${selected.kind}:${selected.id}`]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selected])

  // Derived display/filter state for the ZIP search -- see geocodedZip above
  // for why this is computed here rather than reset via setState in effects.
  const zipComplete = zipInput.length === 5
  const zipPending = zipComplete && geocodedZip !== zipInput
  const displayZipStatus = !zipComplete ? 'idle' : zipPending ? 'loading' : zipStatus
  const activeZipCoords = (zipComplete && !zipPending && zipStatus === 'ok') ? zipCoords : null

  // Whether the map pane is actually visible right now. On desktop it always
  // is; on mobile it's whichever of List/Map the toggle is set to. Threaded
  // into FlyToTarget below, which needs this to avoid animating a hidden,
  // zero-size map container (see the comment on FlyToTarget itself).
  const mapActive = !isMobile || viewMode === 'map'

  // Merges both datasets under one shared "category" dimension -- see
  // trainingCategories below for how the legend still tells them apart.
  const categoryCounts = useMemo(() => {
    const counts = {}
    for (const feature of [...employers, ...trainingProviders]) {
      const category = categoryOf(feature.properties)
      counts[category] = (counts[category] || 0) + 1
    }
    return counts
  }, [employers, trainingProviders])

  // Which category values belong to a training provider -- derived from the
  // data rather than a hardcoded list, so a new provider category picks up
  // the amber/square treatment in the legend automatically. (No employer
  // category has ever collided with a training-provider one; if that ever
  // changes, that category just reads as "training" too, which is a
  // reasonable enough default rather than a bug worth guarding against.)
  const trainingCategories = useMemo(
    () => new Set(trainingProviders.map(feature => categoryOf(feature.properties))),
    [trainingProviders]
  )

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

  const visibleEmployers = useMemo(() => {
    const filtered = employers.filter(feature =>
      !hiddenCategories.has(categoryOf(feature.properties)) &&
      !hiddenZones.has(zoneOf(feature.properties)) &&
      // An employer with no education data is never filtered out by it.
      !(educationOf(feature.properties) &&
        hiddenEducation.has(educationOf(feature.properties))) &&
      // activeZipCoords is only set once zipInput has actually been geocoded
      // (see the derivation above), so a ZIP still being typed/looked
      // up/unrecognised filters nothing out.
      (!activeZipCoords || distanceMiles(
        activeZipCoords.lat, activeZipCoords.lng,
        feature.geometry.coordinates[1], feature.geometry.coordinates[0]
      ) <= zipRadius)
    )
    // Nearest-first only makes sense once there's a point to be near.
    if (!activeZipCoords) return filtered
    return [...filtered].sort((a, b) =>
      distanceMiles(activeZipCoords.lat, activeZipCoords.lng, a.geometry.coordinates[1], a.geometry.coordinates[0]) -
      distanceMiles(activeZipCoords.lat, activeZipCoords.lng, b.geometry.coordinates[1], b.geometry.coordinates[0])
    )
  }, [employers, hiddenCategories, hiddenZones, hiddenEducation, activeZipCoords, zipRadius])

  // Category and Area both apply here now -- category is shared with
  // employers via categoryOf/hiddenCategories (see trainingCategories
  // above), so hiding a provider's category also hides its map pins. There
  // is no education dimension for this dataset.
  const visibleTrainingProviders = useMemo(
    () => trainingProviders.filter(feature =>
      !hiddenCategories.has(categoryOf(feature.properties)) &&
      !hiddenZones.has(zoneOf(feature.properties))
    ),
    [trainingProviders, hiddenCategories, hiddenZones]
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

  // show=true clears the hidden set (every category visible); show=false
  // resets it to the same full known-category list used to seed initial
  // state, so "clear all" matches the app's actual resting state rather
  // than just the categories currently present in the data.
  const toggleAllCategories = (show) => {
    setHiddenCategories(
      show ? new Set() : new Set([...Object.keys(CATEGORY_COLORS), ...TRAINING_CATEGORIES])
    )
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

  const toggleAgency = (agency) => {
    setShownAgencies(prev => {
      const next = new Set(prev)
      if (next.has(agency)) next.delete(agency)
      else next.add(agency)
      return next
    })
  }
  const transitStatus = transitError ? 'error' : transitData ? 'ok' : shownAgencies.size ? 'loading' : 'idle'

  const handleSelect = (feature) => {
    const [lng, lat] = feature.geometry.coordinates
    setSelected({ lat, lng, id: feature.properties.company, kind: 'employer' })
  }

  const handleSelectTraining = (feature) => {
    const [lng, lat] = feature.geometry.coordinates
    setSelected({ lat, lng, id: feature.properties.provider, kind: 'training' })
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
      {isMobile && (
        <div className="mobile-view-toggle">
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            aria-pressed={viewMode === 'list'}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
          <button
            type="button"
            className={viewMode === 'map' ? 'active' : ''}
            aria-pressed={viewMode === 'map'}
            onClick={() => setViewMode('map')}
          >
            Map
          </button>
        </div>
      )}
      <div className={`map-wrapper${isMobile && viewMode !== 'map' ? ' hidden-mobile' : ''}`}>
        <img src="/Small signature logo.png" alt="Logo" className="logo-overlay" />
        {/* Resting state (categories all off by default above) leaves the
            map with nothing plotted -- a blank basemap reads as broken, not
            "nothing selected", so this fills that gap. Keyed on there being
            zero visible pins, NOT on `selected` -- it must clear the moment
            a category/area toggle makes something appear, before the viewer
            has clicked any specific one (a `!selected` trigger was the bug:
            it kept the card up over real, visible pins because nothing had
            been individually clicked yet). pointer-events: none (see CSS) so
            it never blocks panning/zooming the map underneath it. */}
        {visibleEmployers.length === 0 && visibleTrainingProviders.length === 0 && (
          <div className="map-empty-state">
            <div className="map-empty-state-card">
              <p className="map-empty-state-title">Select a job or training provider</p>
              <p className="map-empty-state-hint">
                Turn on a category or area below to see jobs and training providers here.
              </p>
            </div>
          </div>
        )}
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
          {/* CARTO's free dark_all tiles now render an "API key required"
              watermark for anonymous requests, so this uses Esri's free,
              no-key World Dark Gray basemap instead (base canvas + a
              transparent reference layer for labels/roads, matching how
              Esri splits this particular style in two). */}
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
          />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
          />
          <FlyToTarget target={selected} active={mapActive} />
          <TransitLayer data={transitData} shownAgencies={shownAgencies} isMobile={isMobile} />
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
                isActive={selected?.kind === 'employer' && selected?.id === company}
                isMobile={isMobile}
                onSelect={() => handleSelect(feature)}
              />
            )
          })}
          {visibleTrainingProviders.map((feature, i) => {
            const [lng, lat] = feature.geometry.coordinates
            const { provider, address, category, credential_focus, cost_notes } = feature.properties
            return (
              <TrainingMarker
                key={`training-${i}`}
                lat={lat}
                lng={lng}
                provider={provider}
                address={address}
                category={category}
                credential_focus={credential_focus}
                cost_notes={cost_notes}
                isActive={selected?.kind === 'training' && selected?.id === provider}
                isMobile={isMobile}
                onSelect={() => handleSelectTraining(feature)}
              />
            )
          })}
        </MapContainer>
      </div>

      <div className={`sidebar${isMobile && viewMode !== 'list' ? ' hidden-mobile' : ''}`}>
        <div className="sidebar-header">
          <FeedbackButton />
          <h2>Employers</h2>
          <p>
            {visibleEmployers.length} location{visibleEmployers.length !== 1 ? 's' : ''}
            {swVisible !== visibleEmployers.length && (
              <span className="corridor-count"> · {swVisible} in Southwest Detroit</span>
            )}
          </p>
        </div>
        <ZipFilter
          zip={zipInput}
          onZipChange={setZipInput}
          radius={zipRadius}
          onRadiusChange={setZipRadius}
          status={displayZipStatus}
          matchCount={visibleEmployers.length}
        />
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
          trainingCategories={trainingCategories}
          onToggle={toggleCategory}
          onToggleAll={toggleAllCategories}
        />
        <TransitFilter shownAgencies={shownAgencies} onToggle={toggleAgency} status={transitStatus} />

        {trainingProviders.length > 0 && (
          <>
            <button
              type="button"
              className="sidebar-header training-header"
              onClick={() => setTrainingListOpen(o => !o)}
              aria-expanded={trainingListOpen}
            >
              <h2>
                <span className={`chevron${trainingListOpen ? ' open' : ''}`}>&#9656;</span>
                Training Providers
              </h2>
              <p>{visibleTrainingProviders.length} location{visibleTrainingProviders.length !== 1 ? 's' : ''}</p>
            </button>
            {trainingListOpen && (
            <div className="employer-list training-list">
              {visibleTrainingProviders.map((feature, i) => {
                const {
                  provider, category, address, credential_focus,
                  cost_notes, homepage_url, program_page_url,
                } = feature.properties
                const isActive = selected?.kind === 'training' && selected?.id === provider
                const zone = zoneOf(feature.properties)
                const link = program_page_url || homepage_url
                return (
                  <div
                    key={i}
                    ref={el => { itemRefs.current[`training:${provider}`] = el }}
                    className={`employer-item training-item${isActive ? ' active' : ''}${zone !== 'Southwest Detroit' ? ' out-of-scope' : ''}`}
                    onClick={() => handleSelectTraining(feature)}
                  >
                    <div className="company-name">{provider}</div>
                    {zone !== 'Southwest Detroit' && (
                      <div className={`scope-tag ${zoneClass(zone)}`} title={ZONE_META[zone].hint}>
                        {zone}
                      </div>
                    )}
                    <div className="category-line">
                      <span className="category-swatch training-swatch" style={{ backgroundColor: TRAINING_PROVIDER_COLOR }} />
                      {category}
                    </div>
                    {address && <div className="sub-category-line">{address}</div>}
                    {credential_focus && (
                      <div className="credential-tags-line">{credential_focus}</div>
                    )}
                    {cost_notes && <div className="cost-notes-line">{cost_notes}</div>}
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="job-apply-link"
                        onClick={e => e.stopPropagation()}
                      >
                        Programme page&nbsp;&#8599;
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
            )}
          </>
        )}

        <div className="employer-list">
          {visibleEmployers.map((feature, i) => {
            const {
              company, category, sub_category, open_job_count,
              job_titles, apply_urls, job_educations, job_descriptions,
            } = feature.properties
            const isActive = selected?.kind === 'employer' && selected?.id === company
            const zone = zoneOf(feature.properties)
            const [empLng, empLat] = feature.geometry.coordinates
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
                ref={el => { itemRefs.current[`employer:${company}`] = el }}
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
                {activeZipCoords && (
                  <div className="zip-distance-line">
                    {distanceMiles(activeZipCoords.lat, activeZipCoords.lng, empLat, empLng).toFixed(1)} mi from {zipInput}
                  </div>
                )}
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
