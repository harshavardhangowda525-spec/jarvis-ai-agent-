/**
 * RUBEN's screen, built into the desktop app (no JARVIS page needed): the
 * same island component JARVIS serves at /island, bundled by build.mjs into
 * dist/ui.js. Its /api/… requests go to RUBEN's own backend (server.ts).
 */
import { createRoot } from "react-dom/client";
import { RubenIsland } from "@/components/island/ruben-island";

createRoot(document.getElementById("root")!).render(<RubenIsland />);
