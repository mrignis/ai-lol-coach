// Which items has the coach already told this player to buy?
//
// A recorded 33-minute Karthus game asked for Null-Magic Mantle ten separate
// times between 12:28 and 31:05, Oblivion Orb seven times and Cloth Armor
// three — 20 of 73 tips were a repeat purchase order. The prompt already said
// "say it once", but nothing enforced it: the counter-build read stays true
// for as long as the item is unbought, and the last-three-tips window the
// model sees is far too short to notice a theme spanning twenty minutes.
//
// So the check moves here. Item names stay in English in every UI language
// (they are proper nouns and the glossary pins them), which is what makes
// them findable in localized tip text.

/**
 * How many of the given tips asked the player to buy each item.
 *
 * Matched against Data Dragon's real item list rather than by shape: "Wall of
 * Pain" and "Requiem" look exactly like item names, and silencing the coach
 * about the player's own abilities would be a worse bug than the repetition
 * this is here to fix.
 *
 * @param texts  tip strings, any UI language
 * @param items  Set of lowercased item names (ddragon getItemNames())
 */
export function itemsMentioned(texts = [], items) {
  const counts = new Map();
  if (!items || !items.size) return counts;
  // Longest first, so "Oblivion Orb" is not swallowed by a shorter prefix.
  const known = [...items].filter(n => n.length >= 6).sort((a, b) => b.length - a.length);
  for (const text of texts) {
    if (!text) continue;
    const hay = String(text).toLowerCase();
    const seenHere = new Set();
    for (const name of known) {
      if (seenHere.has(name) || !hay.includes(name)) continue;
      seenHere.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Items the coach should stop bringing up: already asked for `limit`+ times.
 * The player has had the chance and bought something else — repeating it is
 * noise, and it crowds out advice they could still act on.
 * Returned in the original casing so the prompt reads naturally.
 */
export function overusedItems(texts = [], items, limit = 2) {
  const title = new Map();
  for (const n of items || []) title.set(n, n.replace(/\b[a-z]/g, c => c.toUpperCase()));
  return [...itemsMentioned(texts, items).entries()]
    .filter(([, n]) => n >= limit)
    .map(([name]) => title.get(name) || name);
}
