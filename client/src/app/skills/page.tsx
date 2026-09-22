import { Suspense } from "react";
import { SkillsView } from "./_components/SkillsView";

/* Route: /skills (Skills Lab). Thin route entry — the two-pane view, its list,
   detail tabs, create modal and import drawer live under _components/.

   The Suspense boundary is what keeps this static route prerenderable:
   SkillsView reads the selection out of `useSearchParams()`, and without a
   boundary the whole tree above it falls back to client rendering. */
export default function SkillsPage() {
  return (
    <Suspense>
      <SkillsView />
    </Suspense>
  );
}
