import { metrics } from '@opentelemetry/api';
import { bestEffortTelemetry } from 'src/shared/observability/span-diagnostics';

const meter = metrics.getMeter('fitwork.demo');
const workspace = meter.createCounter('fitwork_demo_workspaces_total');
const ai = meter.createCounter('fitwork_demo_ai_requests_total');
const cleanup = meter.createCounter('fitwork_demo_cleanup_total');
export const demoMetrics = {
  workspace: (outcome: 'created' | 'failed') =>
    bestEffortTelemetry(() => workspace.add(1, { outcome })),
  ai: (outcome: 'accepted' | 'limited' | 'unavailable') =>
    bestEffortTelemetry(() => ai.add(1, { outcome })),
  cleanup: (outcome: 'completed' | 'failed') =>
    bestEffortTelemetry(() => cleanup.add(1, { outcome })),
};
