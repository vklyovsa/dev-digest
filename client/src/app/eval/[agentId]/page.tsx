import { AgentEvalView } from "./_components/AgentEvalView";

/* Route: /eval/:agentId (one agent's eval view). `params` is a Promise in Next 15. */
export default async function AgentEvalPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentEvalView agentId={agentId} />;
}
