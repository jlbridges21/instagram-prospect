const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "your", "have", "been", "just", "more", "about",
  "they", "them", "their", "what", "when", "where", "instagram", "https", "www", "com", "http",
]);

export type KeywordObservation = {
  text: string;
  status: "approved" | "contacted" | "skipped" | "disqualified";
};

export function suggestPositiveKeywords(input: {
  observations: KeywordObservation[];
  existingKeywords: string[];
  ignored: string[];
  minimum?: number;
}) {
  const minimum = input.minimum ?? 10;
  const positive = input.observations.filter((row) => row.status === "approved" || row.status === "contacted");
  if (positive.length < minimum) return [] as string[];
  const existing = new Set(input.existingKeywords.map((value) => value.trim().toLowerCase()));
  const ignored = new Set(input.ignored.map((value) => value.trim().toLowerCase()));
  const positiveWeights = new Map<string, number>();
  const negativeWeights = new Map<string, number>();
  for (const row of input.observations) {
    const weight = row.status === "approved" ? 3 : row.status === "contacted" ? 2 : 1;
    const target = row.status === "approved" || row.status === "contacted" ? positiveWeights : negativeWeights;
    for (const term of termsFrom(row.text)) {
      target.set(term, (target.get(term) ?? 0) + weight);
    }
  }
  const negativeDocs = Math.max(1, input.observations.length - positive.length);
  return [...positiveWeights.entries()]
    .filter(([term, weight]) => {
      if (existing.has(term) || ignored.has(term) || weight < 3) return false;
      const negative = negativeWeights.get(term) ?? 0;
      const positiveRate = weight / positive.length;
      const negativeRate = negative / negativeDocs;
      return positiveRate >= negativeRate * 2;
    })
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([term]) => term);
}

function termsFrom(text: string) {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const terms = new Set<string>();
  for (const word of words) {
    if (word.length >= 4 && !STOPWORDS.has(word)) terms.add(word);
  }
  for (let index = 0; index < words.length - 1; index += 1) {
    const left = words[index] ?? "";
    const right = words[index + 1] ?? "";
    if (left.length < 3 || right.length < 3 || STOPWORDS.has(left) || STOPWORDS.has(right)) continue;
    terms.add(`${left} ${right}`);
  }
  return terms;
}
