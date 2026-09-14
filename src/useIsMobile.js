import { useEffect, useState } from 'react'

// Must match the `@media (max-width: 899px)` breakpoint in App.css exactly --
// if one changes, change the other. A mismatch here produces a broken hybrid
// layout: the CSS still side-by-side while the JS renders the mobile toggle
// bar, or vice versa.
const BREAKPOINT_QUERY = '(max-width: 899px)'

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(BREAKPOINT_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(BREAKPOINT_QUERY)
    const onChange = (e) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
