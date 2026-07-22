// Categorical palette for employer `category`, validated against the app's
// dark sidebar/map surface (#1a1b22) with the dataviz skill's palette
// validator (lightness band + chroma floor pass; CVD/normal-vision floors
// are the best achievable for 10 simultaneous all-pairs categories — see
// /Users/alejandrohernandez/.claude/plans/graceful-mixing-clock.md). Color is
// a secondary cue here; category/sub_category text is always shown alongside it.
export const NEEDS_REVIEW_COLOR = '#6b7280'

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
  'Needs Review': NEEDS_REVIEW_COLOR,
}

export function colorForCategory(category) {
  return CATEGORY_COLORS[category] || NEEDS_REVIEW_COLOR
}
