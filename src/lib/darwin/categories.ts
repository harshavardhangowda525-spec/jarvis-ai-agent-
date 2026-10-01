/**
 * Which kinds of business DARWIN looks for. Default: cafes, restaurants and gyms
 * only (DARWIN_ONLY_CATEGORIES overrides; "all" lifts the limit). Client-safe.
 */
export const DEFAULT_ALLOWED = ["cafes", "restaurants", "gyms"];

const KEYWORDS: Record<string, RegExp> = {
  cafes: /\b(caf[eé]s?|coffee|tea ?(house|room|shop|bar)s?|bakery ?caf[eé]s?)\b/i,
  restaurants: /\b(restaurants?|eater(y|ies)|dhabas?|bistros?|diners?|food ?(court|joint)s?|dining|biryani|pizzerias?|mess(es)?|canteens?|kitchens?|grills?|bars? ?(&|and) ?restaurants?)\b/i,
  gyms: /\b(gyms?|fitness|crossfit|workout|strength ?(studio|club)s?|health ?clubs?)\b/i,
};

/** The allowed list from a setting ("cafes, restaurants, gyms" / "all" / empty → default). null = no limit. */
export function allowedList(setting: string | null | undefined): string[] | null {
  const s = (setting ?? "").trim();
  if (/^(all|any|\*)$/i.test(s)) return null;
  const xs = s.split(/[,;|\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return xs.length ? xs : DEFAULT_ALLOWED;
}

/** "coffee shops" → "cafes", "fitness centre" → "gyms", "salons" → null (not allowed). */
export function allowedCategory(category: string, allowed: string[] | null): string | null {
  const c = category.trim();
  if (!c) return null;
  if (!allowed) return c;
  for (const a of allowed) {
    const re = KEYWORDS[a];
    const stem = a.replace(/e?s$/, "");
    if ((re && re.test(c)) || c.toLowerCase().includes(stem)) return a;
  }
  return null;
}

/** Keep only allowed kinds ("coffee shops" → "cafes", "salons" dropped); nothing allowed left → the allowed list itself. */
export function onlyAllowed(categories: string[], allowed: string[] | null): string[] {
  if (!allowed) return categories;
  const kept = [...new Set(categories.map((c) => allowedCategory(c, allowed)).filter((c): c is string => !!c))];
  return kept.length ? kept : [...allowed];
}

export function allowedLabel(allowed: string[] | null): string {
  if (!allowed) return "any kind of business";
  return allowed.length === 1 ? allowed[0] : `${allowed.slice(0, -1).join(", ")} and ${allowed.at(-1)}`;
}
