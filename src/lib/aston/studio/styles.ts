/**
 * ASTON's design directions (client-safe). Each is a set of rules the brain
 * designs within — layout, type, colour, components, imagery and motion — so
 * a clinic doesn't come out looking like a fashion portfolio. Chosen from the
 * brief, or by the user ("make it dark and cinematic").
 */
export interface DesignStyle {
  id: string;
  name: string;
  /** what it suits (used to pick a style from the brief) */
  suits: RegExp;
  layout: string;
  type: string;
  color: string;
  components: string;
  imagery: string;
  motion: string;
  avoid: string;
}

export const STYLES: DesignStyle[] = [
  {
    id: "editorial_luxury", name: "Editorial luxury",
    suits: /editorial|luxury|fashion|magazine|photograph|portrait|stylist|designer|atelier|couture|jewel|perfume|model\b/i,
    layout: "Asymmetric 12-column grid with generous negative space; oversized headline blocks that span columns; images offset against text; thin 1px rules dividing sections; a separate long-form story page.",
    type: "A high-contrast display serif (e.g. 'Cormorant Garamond', 'Playfair Display' or 'Bodoni Moda') set very large (clamp up to 9–12rem) with tight leading and slight negative tracking; a restrained grotesk (e.g. 'Inter', 'Manrope') in small caps/uppercase with wide tracking for nav, labels and captions.",
    color: "Warm taupe, beige, ivory and charcoal, with true monochrome photography; one dark section (charcoal/near-black) for contrast; no saturated accents.",
    components: "Minimal top navigation (wordmark left, 3–5 text links right, small 'Menu' toggle on mobile); numbered sections (01 — ); large pull quotes; selected-work list with hover image reveal; restrained footer with a big wordmark.",
    imagery: "Large portrait-format monochrome images, cropped tight, sometimes overlapping a headline; grain; captions in small caps.",
    motion: "Slow, cinematic: headline lines rise and fade in on load (staggered 80–120ms); images reveal with a clip-path wipe on scroll; subtle parallax on hero image; page fade between pages. All disabled under prefers-reduced-motion.",
    avoid: "Gradients, rounded cards, drop shadows, icons, emoji, stock-looking 'feature grids', more than two typefaces.",
  },
  {
    id: "personal_brand", name: "Premium personal brand",
    suits: /personal brand|coach\b|speaker|author|founder|consultant|influencer|creator|portfolio of me|about me/i,
    layout: "A strong hero with name + positioning line and a portrait; credibility strip (logos/press as text); offers/services; story; testimonials; booking CTA.",
    type: "A characterful serif or modern display face for headlines paired with a clean sans for body; large confident sizes.",
    color: "One signature colour plus warm neutrals; high contrast CTAs.",
    components: "Sticky nav with a primary 'Work with me' button; offer cards with clear outcomes; testimonial carousel or grid; newsletter or enquiry form.",
    imagery: "Warm, natural portraits; candid working shots.",
    motion: "Gentle fade/slide reveals; hover lifts on offer cards; counter-free (no fake statistics).",
    avoid: "Fake follower counts, invented testimonials (mark placeholders), generic stock photos.",
  },
  {
    id: "modern_saas", name: "Modern SaaS",
    suits: /saas|software|app\b|platform|startup|api|dashboard|tool for|b2b software|ai product/i,
    layout: "Centered hero with product screenshot/mock UI; logos; feature sections alternating text and UI; pricing table; FAQ; final CTA.",
    type: "A geometric or neo-grotesk sans (e.g. 'Inter', 'Plus Jakarta Sans', 'Geist') with tight headline tracking; monospace accents for code.",
    color: "Neutral base (white or near-black) with one vivid brand accent and subtle tinted surfaces.",
    components: "Product UI built in HTML/CSS (not images), feature grid, pricing cards with a highlighted plan, FAQ accordion (buttons with aria-expanded), sign-up/waitlist form.",
    imagery: "Interface mockups drawn in HTML/CSS/SVG; diagrams.",
    motion: "Crisp and fast (150–250ms); UI elements animate in; accordion transitions.",
    avoid: "Fake customer logos or metrics presented as real.",
  },
  {
    id: "corporate", name: "Corporate & professional services",
    suits: /law|legal|account|ca firm|audit|consult|finance|insurance|corporate|advisory|tax|architecture firm|engineering firm/i,
    layout: "Clear hierarchy: hero with value proposition, services grid, sectors, approach/process, team, insights, contact. Predictable navigation with a contact CTA.",
    type: "A sober serif or humanist sans for headings, highly readable sans body; moderate sizes.",
    color: "Navy, slate, white, with a restrained accent (teal, gold or green).",
    components: "Service cards, process steps, team grid, office/contact block with map link, enquiry form.",
    imagery: "Architectural or abstract imagery; team portraits.",
    motion: "Minimal: subtle fades only.",
    avoid: "Playful illustrations, loud colours, gimmicky motion.",
  },
  {
    id: "ecommerce", name: "E-commerce storefront",
    suits: /shop|store|e-?commerce|sell online|products?|boutique|brand store|apparel|merch/i,
    layout: "Hero with featured collection; category tiles; product grid with filters; product detail page; cart drawer; checkout handoff.",
    type: "Brand-appropriate display face with a neutral sans for UI and prices.",
    color: "Product-led: neutral backgrounds so products carry the colour.",
    components: "Product cards (name, price, add to cart), a working cart in localStorage (quantities update, totals compute), filters that really filter the product list, cart drawer that opens/closes. Checkout is a clearly marked integration boundary (payment provider not configured) unless keys are provided.",
    imagery: "Product shots on clean backgrounds (placeholders until real products are supplied).",
    motion: "Quick hover swaps, cart drawer slide, add-to-cart feedback.",
    avoid: "Fake prices or stock counts presented as real (mark placeholders); fake checkout success.",
  },
  {
    id: "hospitality", name: "Restaurant & hospitality",
    suits: /restaurant|cafe|café|coffee|bar\b|bistro|hotel|resort|bakery|dining|kitchen|eatery|brewery|homestay/i,
    layout: "Atmospheric hero; story; menu (by section); gallery; reservations/booking; location & hours; footer.",
    type: "A warm serif or expressive display for headings, friendly sans body; menu set in a classic layout with dotted leaders or aligned prices.",
    color: "Warm, appetising palette drawn from the cuisine/interior (terracotta, olive, cream, deep green, espresso).",
    components: "Menu with categories, reservation form with date/time/party size (real booking handler, one booking per slot), hours table, map/directions link, call button.",
    imagery: "Food and interior photography (placeholders until supplied), warm light.",
    motion: "Soft reveals; gallery hover zoom.",
    avoid: "Invented reviews or awards, fake menu prices presented as real (mark placeholders).",
  },
  {
    id: "healthcare", name: "Clinic & healthcare",
    suits: /clinic|hospital|doctor|dental|dentist|physio|health|medical|therap|pharma|diagnostic|ayurved|wellness centre/i,
    layout: "Reassuring hero with appointment CTA; services/treatments; doctors; why choose us (factual); patient info; FAQs; appointment booking; contact & hours.",
    type: "Highly legible humanist sans (e.g. 'Source Sans 3', 'Nunito Sans'); generous size and line height.",
    color: "Calm blues/teals/greens with lots of white; strong contrast for accessibility (WCAG AA).",
    components: "Appointment form (department, doctor, date, time slot — one booking per slot), service cards, doctor profiles, emergency/phone banner, FAQ accordion.",
    imagery: "Clean, human, reassuring (placeholders until supplied).",
    motion: "Very subtle; nothing that distracts.",
    avoid: "Medical claims, invented credentials or success rates, fear-based copy.",
  },
  {
    id: "fitness", name: "Fitness & gym",
    suits: /gym|fitness|crossfit|yoga|pilates|martial|boxing|personal train|sports club|athlet/i,
    layout: "High-energy hero with bold statement; programs/classes; schedule/timetable; membership plans; trainers; trial/enquiry form; location.",
    type: "Condensed bold sans (e.g. 'Oswald', 'Anton', 'Barlow Condensed') in uppercase for headlines; clean sans body.",
    color: "Dark base (black/charcoal) with one electric accent (lime, orange or red).",
    components: "Membership plan cards with real enquiry/trial form, class timetable (filter by day really works), trainer cards, sticky 'Book a trial' CTA.",
    imagery: "High-contrast action photography (placeholders), diagonal crops.",
    motion: "Punchy: fast slide-ins, marquee of class names, hover scale on cards.",
    avoid: "Fake transformation stories or member counts.",
  },
  {
    id: "real_estate", name: "Real estate",
    suits: /real estate|realty|property|properties|villa|apartment|builder|developer|interior|homes?\b|estate agent/i,
    layout: "Cinematic hero; featured properties; search/filter listings; property detail; amenities; location; enquiry/site-visit booking.",
    type: "Elegant serif headings with a refined sans; spacious.",
    color: "Stone, sand, deep green or navy with brass/gold accents.",
    components: "Listing cards with price/area/beds (placeholders unless supplied), filters that really filter, gallery, site-visit booking form, floor-plan/amenity sections.",
    imagery: "Wide architectural and lifestyle imagery.",
    motion: "Slow image reveals, parallax, gallery transitions.",
    avoid: "Invented RERA numbers, prices or availability presented as real.",
  },
  {
    id: "agency", name: "Creative agency & portfolio",
    suits: /agency|studio\b|creative|portfolio|branding|design studio|film|production house|photographer|illustrator|artist/i,
    layout: "Bold statement hero; selected work (case-study grid with hover); services; process; clients (as text); contact.",
    type: "Expressive display face (large, playful or experimental) with a neutral sans.",
    color: "Bold: either stark black/white with one accent or a confident colour field per section.",
    components: "Work grid with filters, case-study page template, cursor/hover effects (non-essential), contact form.",
    imagery: "Project imagery full-bleed (placeholders until supplied).",
    motion: "Expressive but purposeful: text splits, marquee, magnetic hover; respects reduced motion.",
    avoid: "Fake client logos presented as real.",
  },
  {
    id: "education", name: "Educational & coaching",
    suits: /school|tuition|coaching cent|academy|course|institute|education|learning|training cent|kids|preschool|college/i,
    layout: "Friendly hero with outcome-led promise; programs/courses; how it works; faculty; schedule/batches; FAQs; enrolment/enquiry form.",
    type: "Rounded or humanist sans (e.g. 'Nunito', 'DM Sans', 'Lexend') with clear hierarchy.",
    color: "Optimistic, accessible palette (one primary + one secondary), white space.",
    components: "Course cards, batch timetable, enquiry/enrolment form, FAQ accordion, faculty cards.",
    imagery: "Learners and classrooms (placeholders), simple illustrations in SVG.",
    motion: "Light, encouraging reveals.",
    avoid: "Invented results/ranks or guarantees.",
  },
  {
    id: "dark_cinematic", name: "Dark cinematic",
    suits: /cinematic|dark|film|night|club|event|launch|music|gaming|automotive|premium dark/i,
    layout: "Full-viewport scenes; each section a 'shot'; large type over imagery; horizontal or sticky storytelling sections.",
    type: "Wide or condensed display sans or a sharp serif, very large, with a light sans for body.",
    color: "Near-black backgrounds, off-white type, one glowing accent; deep gradients only as lighting, not decoration.",
    components: "Sticky scroll scenes, full-bleed media, chaptered navigation, waitlist/enquiry form.",
    imagery: "Moody, high-contrast, cinematic crops; film grain.",
    motion: "Cinematic: slow scale/fade, scroll-driven scenes, light leaks — all off under reduced motion.",
    avoid: "Low-contrast body text, autoplaying sound.",
  },
  {
    id: "product_showcase", name: "Minimalist product showcase",
    suits: /product|device|gadget|launch|hardware|wearable|furniture|object|single product/i,
    layout: "One product, many angles: hero with product, feature callouts around it, specs table, gallery, buy/pre-order or enquiry.",
    type: "Precise neo-grotesk (e.g. 'Inter Tight', 'Manrope'), large clean numerals for specs.",
    color: "Near-white or near-black with the product's own colour as accent.",
    components: "Feature callouts, specs table, colour/variant switcher that really switches the shown variant, pre-order/enquiry form.",
    imagery: "Product renders/photos on seamless backgrounds (placeholders until supplied).",
    motion: "Smooth product reveals, sticky feature walkthrough.",
    avoid: "Fake specs presented as real (mark placeholders).",
  },
];

export const STYLE_IDS = STYLES.map((s) => s.id) as [string, ...string[]];
export const styleById = (id: string | null | undefined) => STYLES.find((s) => s.id === id) ?? null;

/** The style a brief most likely wants (an explicit style word beats the business type). */
export function suggestStyle(brief: string): DesignStyle {
  const explicit = STYLES.find((s) => new RegExp(`\\b${s.name.split(" ")[0]}\\b`, "i").test(brief) && /style|look|feel|aesthetic|inspired|like/i.test(brief));
  if (explicit) return explicit;
  // editorial/luxury/cinematic words describe the look, so they win over the business type
  for (const id of ["editorial_luxury", "dark_cinematic"]) { const s = styleById(id)!; if (s.suits.test(brief) && /editorial|luxury|cinematic|magazine/i.test(brief)) return s; }
  return STYLES.find((s) => s.suits.test(brief)) ?? styleById("corporate")!;
}

export function styleBrief(s: DesignStyle) {
  return `DESIGN DIRECTION: ${s.name}
- Layout: ${s.layout}
- Typography: ${s.type}
- Colour: ${s.color}
- Components: ${s.components}
- Imagery: ${s.imagery}
- Motion: ${s.motion}
- Avoid: ${s.avoid}`;
}
