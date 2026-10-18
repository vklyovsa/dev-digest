"use client";

import React from "react";
import { useRunEvents } from "@/lib/hooks/reviews";

/** Follows one running child's event stream and fires `onSettled` once it ends. Renders nothing. */
export function ChildRunWatcher({ runId, onSettled }: { runId: string; onSettled: () => void }) {
  const { running } = useRunEvents([runId]);
  const seenRunning = React.useRef(false);
  const latest = React.useRef(onSettled);
  latest.current = onSettled;

  React.useEffect(() => {
    if (running) {
      seenRunning.current = true;
    } else if (seenRunning.current) {
      seenRunning.current = false;
      latest.current();
    }
  }, [running]);

  return null;
}
