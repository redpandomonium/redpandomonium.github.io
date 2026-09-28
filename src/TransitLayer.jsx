import { memo, useMemo, useState } from 'react'
import { Pane, Polyline, CircleMarker, Tooltip, Popup, useMap, useMapEvents } from 'react-leaflet'
import { TRANSIT_AGENCIES } from './transitAgencies'

// Below this zoom ~10,000 stops would carpet the map and bury the employer
// pins, so stops only appear once zoomed into a few neighbourhoods at most.
const STOP_MIN_ZOOM = 15

// Hover-only tooltips don't work on touch (see the note on TrainingMarker in
// App.jsx), so on mobile a tap opens a dismissable popup instead.
function InfoLabel({ isMobile, children }) {
  return isMobile ? <Popup>{children}</Popup> : <Tooltip sticky>{children}</Tooltip>
}

const RouteLine = memo(function RouteLine({ positions, agency, route, name, isRail, isMobile }) {
  const meta = TRANSIT_AGENCIES[agency]
  const weight = isRail ? 4 : 2
  const opacity = isRail ? 0.9 : 0.4
  return (
    <Polyline
      positions={positions}
      pathOptions={{ color: meta.color, weight, opacity, dashArray: meta.dash }}
      eventHandlers={{
        mouseover: e => { e.target.setStyle({ weight: weight + 2, opacity: 1 }); e.target.bringToFront() },
        mouseout: e => e.target.setStyle({ weight, opacity }),
      }}
    >
      <InfoLabel isMobile={isMobile}>
        <strong>{meta.label}{route && route !== name ? ` ${route}` : ''}</strong>
        {name && <> · {name}</>}
      </InfoLabel>
    </Polyline>
  )
})

// Tracks zoom + viewport so only stops actually on screen are mounted --
// thousands of SVG circles, even invisible ones, make panning stutter.
function VisibleStops({ stops, shownAgencies, isMobile }) {
  const map = useMap()
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }))
  // moveend also fires at the end of every zoom, so one handler covers both.
  useMapEvents({ moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }) })

  const inView = useMemo(() => {
    if (view.zoom < STOP_MIN_ZOOM) return []
    const bounds = view.bounds.pad(0.2)
    return stops.filter(s => shownAgencies.has(s.agency) && bounds.contains(s.latlng))
  }, [stops, shownAgencies, view])

  return inView.map(s => (
    <CircleMarker
      key={s.key}
      center={s.latlng}
      radius={3.5}
      pathOptions={{ color: '#1a1b22', weight: 1, fillColor: TRANSIT_AGENCIES[s.agency].color, fillOpacity: 0.9 }}
    >
      <InfoLabel isMobile={isMobile}>
        <strong>{s.name}</strong><br />
        {TRANSIT_AGENCIES[s.agency].label}: {s.routes.join(', ')}
      </InfoLabel>
    </CircleMarker>
  ))
}

// `data` is { routes, stops } as parsed from the two GeoJSON files, or null
// while still loading. Everything sits in its own panes below Leaflet's
// default overlayPane (z-index 400), so employer and training markers are
// always drawn -- and clickable -- on top of the lines.
export default function TransitLayer({ data, shownAgencies, isMobile }) {
  const routes = useMemo(() => (data?.routes || []).map((f, i) => ({
    key: `${f.properties.agency}-${f.properties.route}-${i}`,
    agency: f.properties.agency,
    route: f.properties.route,
    name: f.properties.name,
    isRail: f.properties.route_type !== 3,
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
    positions: f.geometry.coordinates.map(line => line.map(([lng, lat]) => [lat, lng])),
  })), [data])

  const stops = useMemo(() => (data?.stops || []).map((f, i) => ({
    key: `${f.properties.agency}-${i}`,
    agency: f.properties.agency,
    name: f.properties.name,
    routes: f.properties.routes,
    latlng: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
  })), [data])

  if (!data || shownAgencies.size === 0) return null

  // Rail last so it draws over the bus lines that run alongside it.
  const visible = routes
    .filter(r => shownAgencies.has(r.agency))
    .sort((a, b) => a.isRail - b.isRail)

  return (
    <>
      <Pane name="transit-routes" style={{ zIndex: 350 }}>
        {visible.map(r => (
          <RouteLine
            key={r.key}
            positions={r.positions}
            agency={r.agency}
            route={r.route}
            name={r.name}
            isRail={r.isRail}
            isMobile={isMobile}
          />
        ))}
      </Pane>
      <Pane name="transit-stops" style={{ zIndex: 360 }}>
        <VisibleStops stops={stops} shownAgencies={shownAgencies} isMobile={isMobile} />
      </Pane>
    </>
  )
}
