function shortId (id) {
  const s = String(id ?? '')
  return s ? s.slice(0, 6) : 'no-id'
}

export function candidateDebugLabel (candidate) {
  const name = String(candidate?.geekName || candidate?.name || 'unknown')
  return `${name}#${shortId(candidate?.encryptGeekId)}`
}

export function summarizeOpenOrder (candidates, prescore) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({
    rank: index + 1,
    candidate: candidateDebugLabel(candidate),
    prescore: Number(prescore(candidate) || 0),
    schoolRank: candidate?._schoolRank ?? 0,
    hasViewed: !!candidate?._hasViewed,
    activeText: candidate?.activeText || ''
  }))
}

export function summarizeScoreResult (result) {
  return {
    candidate: candidateDebugLabel(result?.candidate),
    score: result?.score,
    hardReject: result?.hardReject === true,
    reason: result?.reason || '',
    resumeChars: result?.resumeChars ?? 0,
    summaryChars: result?.summaryChars ?? 0,
    canvasOk: result?.canvasOk === true,
    resumeVerified: result?.resumeVerified === true,
    resumeEvidence: result?.resumeEvidence || 'none',
    llmError: result?.llmError === true
  }
}

export function summarizeGreetSelection (scored, selected, minScore) {
  const selectedIds = new Set((Array.isArray(selected) ? selected : []).map((s) => s?.candidate?.encryptGeekId))
  return (Array.isArray(scored) ? scored : [])
    .map((entry) => {
      const selected = selectedIds.has(entry?.candidate?.encryptGeekId)
      let skippedReason = ''
      if (!selected) {
        if (entry?.hardReject) skippedReason = 'hardReject'
        else if (typeof entry?.score !== 'number' || entry.score < minScore) skippedReason = 'belowThreshold'
        else if (entry?.resumeVerified === false || (entry?.resumeVerified == null && entry?.canvasOk === false)) skippedReason = 'resumeNotVerified'
        else skippedReason = 'outsideBudget'
      }
      return {
        candidate: candidateDebugLabel(entry?.candidate),
        score: entry?.score,
        selected,
        skippedReason
      }
    })
    .sort((a, b) => (b.selected - a.selected) || ((b.score ?? -Infinity) - (a.score ?? -Infinity)))
    .map((entry, index) => ({ rank: index + 1, ...entry }))
}
