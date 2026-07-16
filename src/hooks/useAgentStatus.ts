import { useState } from 'react';
import type { AgentStatus } from '../types/agent';

export function useAgentStatus() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');

  return { agentStatus, setAgentStatus };
}
