import type { JobsEnv, StagingJobMessage } from "../../shared/types";

export default {
  queue(batch: MessageBatch<StagingJobMessage>) {
    for (const message of batch.messages) {
      message.retry();
    }
  },
  scheduled() {
    throw new Error("STAGING_NOT_IMPLEMENTED");
  },
} satisfies ExportedHandler<JobsEnv, StagingJobMessage>;
