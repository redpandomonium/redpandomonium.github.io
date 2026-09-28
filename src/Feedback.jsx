import { useEffect, useState } from 'react'

// The Google Form's "Send" -> link URL, in its full form:
//   https://docs.google.com/forms/d/e/<long id>/viewform
// (not the forms.gle short link -- that one redirects and can't be embedded).
// Responses go wherever the form is set to send them (a linked Google Sheet).
// While this is empty the whole feedback UI renders nothing, so the live site
// never shows a button that opens onto a broken form.
export const FEEDBACK_FORM_URL = ''

function embedUrl(url) {
  try {
    const u = new URL(url)
    u.searchParams.set('embedded', 'true')
    return u.toString()
  } catch {
    return url
  }
}

// A button (in the sidebar header) that opens the form in an overlay rather
// than navigating away, so a visitor who was mid-browse doesn't lose their
// filters and place in the list.
export default function FeedbackButton() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!FEEDBACK_FORM_URL) return null

  return (
    <>
      <button type="button" className="feedback-button" onClick={() => setOpen(true)}>
        Feedback
      </button>
      {open && (
        <div className="feedback-overlay" onClick={() => setOpen(false)}>
          <div
            className="feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Send feedback"
            onClick={e => e.stopPropagation()}
          >
            <div className="feedback-dialog-header">
              <h2>Send feedback</h2>
              <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer" className="feedback-open-tab">
                Open in new tab&nbsp;&#8599;
              </a>
              <button type="button" className="feedback-close" onClick={() => setOpen(false)} aria-label="Close">
                &times;
              </button>
            </div>
            <iframe src={embedUrl(FEEDBACK_FORM_URL)} title="Feedback form" className="feedback-frame">
              Loading&hellip;
            </iframe>
          </div>
        </div>
      )}
    </>
  )
}
