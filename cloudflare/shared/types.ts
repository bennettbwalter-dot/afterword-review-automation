export type StagingJobMessage =
  | {
      kind: "diagnostic";
      id: string;
      requestedAt: string;
    }
  | {
      kind: "delivery-kick";
      id: string;
      requestedAt: string;
    };

interface SharedStaticAssets {
  fetch(request: Request): Promise<Response>;
}

export interface ApplicationEnv {
  APP_ORIGIN: string;
  PUBLIC_REVIEW_ORIGIN: string;
  SESSION_PEPPER: string;
  DATA_HASH_PEPPER: string;
  FIELD_ENCRYPTION_KEY: string;
  AUTH_DB: Hyperdrive;
  RUNTIME_DB: Hyperdrive;
  JOBS_QUEUE?: Queue<StagingJobMessage>;
  ASSETS: SharedStaticAssets;
}

export interface IngressEnv {
  APP_ORIGIN: string;
  PUBLIC_REVIEW_BASE_URL: string;
  EXTERNAL_WEBHOOK_BASE_URL: string;
  DATA_HASH_PEPPER: string;
  FIELD_ENCRYPTION_KEY: string;
  INGRESS_DB: Hyperdrive;
  ASSETS: SharedStaticAssets;
}

export interface JobsEnv {
  PROVIDER_DELIVERY_ENABLED: "false";
  FIELD_ENCRYPTION_KEY: string;
  WORKER_DB: Hyperdrive;
}
