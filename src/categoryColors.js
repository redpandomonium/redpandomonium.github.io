// Categorical palette for employer `category`, validated against the app's
// dark sidebar/map surface (#1a1b22) with the dataviz skill's palette
// validator (lightness band + chroma floor pass; CVD/normal-vision floors
// are the best achievable for 10 simultaneous all-pairs categories — see
// /Users/alejandrohernandez/.claude/plans/graceful-mixing-clock.md). Color is
// a secondary cue here; category/sub_category text is always shown alongside it.
// Fallback colour for an employer whose category is blank or unrecognised.
// Every employer is categorised as of 2026-08-05, so nothing uses this today --
// but a future scrape can introduce an uncategorised row, and it must still be
// drawn rather than silently dropped from the map.
export const NEEDS_REVIEW_COLOR = '#6b7280'
export const UNCATEGORISED_LABEL = 'Needs Review'

export const CATEGORY_COLORS = {
  'Transportation, Logistics & Distribution': '#247aba',
  'Construction, Infrastructure & Engineering': '#169fb5',
  'Advanced Manufacturing & Heavy Industry': '#008a78',
  'Education & Workforce Development': '#8b4d85',
  'Energy, Utilities & Environmental Services': '#d76a49',
  'Materials, Mining & Extraction': '#cb6c98',
  'Healthcare & Public Safety': '#59a26d',
  'Workforce, Staffing & Employment Services': '#6493e0',
  'Government & Military': '#3c7134',
  'Commercial, Hospitality & Retail': '#9f4b00',
}

export function colorForCategory(category) {
  return CATEGORY_COLORS[category] || NEEDS_REVIEW_COLOR
}
