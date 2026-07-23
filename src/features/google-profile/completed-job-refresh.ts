type CompletedJobRefreshOptions<Workspace> = {
  create: () => Promise<unknown>;
  invalidateSnapshot: () => void;
  refreshWorkspace: () => Promise<Workspace>;
  applyWorkspace: (workspace: Workspace) => void;
  reportRefreshError: (message: string) => void;
};

export async function createCompletedJobAndRefreshWorkspace<Workspace>({
  create,
  invalidateSnapshot,
  refreshWorkspace,
  applyWorkspace,
  reportRefreshError,
}: CompletedJobRefreshOptions<Workspace>) {
  await create();
  invalidateSnapshot();
  try {
    applyWorkspace(await refreshWorkspace());
  } catch (caught) {
    const detail = caught instanceof Error ? ` ${caught.message}` : "";
    reportRefreshError(`The completed job was saved, but the workspace could not be refreshed.${detail}`);
  }
}
