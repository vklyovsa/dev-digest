import { Suspense } from "react";
import { AgentPerformanceView } from "./_components/AgentPerformanceView";

/* Route: /agent-performance. Thin server entry — the view reads useSearchParams, so it sits under Suspense. */
export default function AgentPerformancePage() {
  return (
    <Suspense>
      <AgentPerformanceView />
    </Suspense>
  );
}
