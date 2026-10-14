// Few-shot example retrieval: turn confirmed query history into (question -> intent)
// pairs that the model can use as in-context demonstrations. Pure and side-effect free.

const CHUNK = /[a-z0-9_]{3,}|[\u4e00-\u9fff]{1,4}/g;

function tokens(text) {
  return [...new Set(String(text || '').toLowerCase().match(CHUNK) || [])];
}

function similarity(queryTokens, target) {
  const text = String(target || '').toLowerCase();
  return queryTokens.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
}

export function selectExamples(query, queries, limit = 3) {
  const queryTokens = tokens(query);
  if (!queryTokens.length || !Array.isArray(queries) || !queries.length) return [];
  return queries
    .map((q) => ({
      q,
      score: similarity(queryTokens, [q.request, q.name, q.summary, q.metric?.name].filter(Boolean).join(' ')),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ q }) => ({
      question: String(q.request || q.name || '').slice(0, 600),
      intent: {
        summary: q.summary,
        metricId: q.metric?.id ?? null,
        startDate: q.definition?.startDate ?? '',
        endDate: q.definition?.endDate ?? '',
        grain: q.definition?.grain ?? 'total',
        timeField: q.definition?.timeField ?? '',
        dimension: q.definition?.dimension ?? '',
        scopeFilters: q.definition?.scopeFilters ?? [],
      },
    }));
}
