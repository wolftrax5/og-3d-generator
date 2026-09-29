import { handleCallback } from '@vercel/queue';

import { isRenderJob } from '@/lib/og3d/job';
import { renderJob } from '@/lib/og3d/sandbox-worker';

// First boot installs lavapipe and npm packages inside the sandbox.
export const maxDuration = 800;

export const POST = handleCallback(
  async (message, metadata) => {
    if (!isRenderJob(message)) {
      console.error('og-3d: dropping invalid render job', metadata.messageId);
      return;
    }
    await renderJob(message);
  },
  { visibilityTimeoutSeconds: 900 },
);
