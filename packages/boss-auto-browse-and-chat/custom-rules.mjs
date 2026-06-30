const VALID_FIELDS = new Set(['name', 'skills', 'school', 'major', 'profile', 'all'])
const VALID_OPERATORS = new Set(['containsAny', 'notContainsAny', 'regex'])

function listify (value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v ?? '').trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(/[,，\n]/).map(v => v.trim()).filter(Boolean)
  }
  return []
}

function safeRegExp (pattern) {
  if (!pattern || typeof pattern !== 'string') return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

function flattenKnownText (candidate) {
  if (!candidate || typeof candidate !== 'object') return ''
  const parts = []
  for (const value of Object.values(candidate)) {
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value))
    } else if (Array.isArray(value)) {
      parts.push(value.filter(v => typeof v === 'string' || typeof v === 'number').join(' '))
    }
  }
  return parts.join(' ')
}

export function getCustomRuleFieldText (candidate, field) {
  const c = candidate || {}
  const schools = [
    ...(Array.isArray(c.schools) ? c.schools : []),
    ...(Array.isArray(c.tags) ? c.tags : []),
    c.school,
    c.resumeText
  ]
  const majors = [
    ...(Array.isArray(c.majors) ? c.majors : []),
    c.major,
    c.resumeText
  ]
  const profile = [
    c.resumeText,
    c.profile,
    c.extraText,
    c.summary,
    c.advantage,
    c.advantages,
    c.skills
  ]

  switch (field) {
    case 'name':
      return [c.geekName, c.name].filter(Boolean).join(' ')
    case 'skills':
      return [c.skills, c.advantage, c.advantages, c.summary, c.resumeText].filter(Boolean).join(' ')
    case 'school':
      return schools.filter(Boolean).join(' ')
    case 'major':
      return majors.filter(Boolean).join(' ')
    case 'profile':
      return profile.filter(Boolean).join(' ')
    case 'all':
    default:
      return flattenKnownText(c)
  }
}

function conditionMatches (candidate, condition) {
  if (!condition || typeof condition !== 'object') return false
  const field = VALID_FIELDS.has(condition.field) ? condition.field : 'all'
  const operator = VALID_OPERATORS.has(condition.operator) ? condition.operator : 'containsAny'
  const haystack = getCustomRuleFieldText(candidate, field).toLowerCase()

  if (operator === 'regex') {
    const reg = safeRegExp(condition.pattern)
    return reg ? reg.test(getCustomRuleFieldText(candidate, field)) : false
  }

  const keywords = listify(condition.keywords)
  if (keywords.length === 0) return false
  const hasAny = keywords.some(kw => haystack.includes(kw.toLowerCase()))
  return operator === 'notContainsAny' ? !hasAny : hasAny
}

export function evaluateCustomRules (candidate, rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { matched: false }
  }

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]
    if (!rule || rule.enabled === false || rule.action !== 'reject') continue
    if (!conditionMatches(candidate, rule)) continue
    if (conditionMatches(candidate, rule.except)) continue

    const label = rule.label || `规则 ${index + 1}`
    return {
      matched: true,
      reason: 'customRule',
      reasonDetail: `自定义硬筛规则「${label}」命中`
    }
  }

  return { matched: false }
}
