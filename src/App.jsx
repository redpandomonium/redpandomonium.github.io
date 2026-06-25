import { memo, useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import './App.css'

const EmployerMarker = memo(function EmployerMarker({ lat, lng, company, full_address, business_type, open_job_count, isActive, onSelect }) {
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={isActive ? 11 : 8}
      pathOptions={{
        color: isActive ? '#fff' : '#66b245',
        fillColor: '#689cca',
        fillOpacity: isActive ? 1 : 0.8,
        weight: isActive ? 2 : 1,
      }}
      eventHandlers={{ click: onSelect }}
    >
      <Tooltip>
        <strong>{company}</strong><br />
        {full_address}<br />
        {business_type}<br />
        {open_job_count} open job{open_job_count !== 1 ? 's' : ''}
      </Tooltip>
    </CircleMarker>
  )
})

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

  useEffect(() => {
    fetch('/employers_geocoded.geojson')
      .then(res => res.json())
      .then(data => setEmployers(data.features))
  }, [])

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
          zoom={12}
          minZoom={11}
          maxBounds={[[42.1, -83.4], [42.5, -82.8]]}
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
          {employers.map((feature, i) => {
            const [lng, lat] = feature.geometry.coordinates
            const { company, full_address, business_type, open_job_count } = feature.properties
            return (
              <EmployerMarker
                key={i}
                lat={lat}
                lng={lng}
                company={company}
                full_address={full_address}
                business_type={business_type}
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
          <p>{employers.length} locations</p>
        </div>
        <div className="employer-list">
          {employers.map((feature, i) => {
            const { company, business_type, open_job_count, job_titles } = feature.properties
            const isActive = selected?.id === company
            const titles = job_titles ? job_titles.split(' | ').filter(Boolean) : []
            return (
              <div
                key={i}
                className={`employer-item${isActive ? ' active' : ''}`}
                onClick={() => handleSelect(feature)}
              >
                <div className="company-name">{company}</div>
                <div className="business-type">{business_type || 'Unknown type'}</div>
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
