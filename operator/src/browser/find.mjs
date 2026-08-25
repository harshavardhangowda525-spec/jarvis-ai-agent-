/**
 * Element finding. Prefers the stable `data-op-id` assigned by observe(); falls
 * back to robust, semantic locators (role + accessible name, label, placeholder,
 * visible text) — never brittle nth-child CSS. Position is a last resort.
 */

/** Locator for an element previously tagged by observe(). */
export function byOpId(page, id) {
  return page.locator(`[data-op-id="${id}"]`);
}

/**
 * Best-effort semantic finder used when we don't have an op-id (e.g. the model
 * describes a target by name/role). Returns the first locator that resolves to
 * exactly one visible element, or null.
 */
export async function findSemantic(page, { role, name, placeholder, text } = {}) {
  const candidates = [];
  if (role && name) candidates.push(page.getByRole(role, { name, exact: false }));
  if (name) candidates.push(page.getByLabel(name, { exact: false }));
  if (placeholder) candidates.push(page.getByPlaceholder(placeholder, { exact: false }));
  if (text) candidates.push(page.getByText(text, { exact: false }));
  if (name) candidates.push(page.getByText(name, { exact: false }));
  if (role) candidates.push(page.getByRole(role));

  for (const loc of candidates) {
    try {
      const first = loc.first();
      if (await first.count() && await first.isVisible().catch(() => false)) return first;
    } catch { /* try next candidate */ }
  }
  return null;
}
