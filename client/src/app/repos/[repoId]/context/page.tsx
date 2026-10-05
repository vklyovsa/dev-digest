import { Suspense } from "react";
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  return (
    <Suspense>
      <ProjectContextView />
    </Suspense>
  );
}
