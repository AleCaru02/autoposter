/** Pure readiness gate for personal video production. */
export type VideoStudioCapabilities = {
  editorialMemory: boolean;
  textGenerationApi: boolean;
  licensedMedia: boolean;
  editorSchemaVerified: boolean;
  rendererReachable: boolean;
  voiceReady: boolean;
  avatarReady: boolean;
  publicationConnected: boolean;
  analyticsConnected: boolean;
  approvalWorkflow: boolean;
};
export type VideoStudioReadiness = {
  canDraft: boolean;
  canRender: boolean;
  canQueueForApproval: boolean;
  canPublish: boolean;
  canLearn: boolean;
  blockers: string[];
};
export function assessVideoStudioReadiness(c: VideoStudioCapabilities): VideoStudioReadiness {
  const canDraft = c.editorialMemory && c.textGenerationApi;
  const canRender = canDraft && c.licensedMedia && c.editorSchemaVerified && c.rendererReachable;
  const canQueueForApproval = canRender && c.approvalWorkflow;
  const canPublish = canQueueForApproval && c.publicationConnected;
  const canLearn = canPublish && c.analyticsConnected;
  const blockers = (Object.entries(c) as Array<[keyof VideoStudioCapabilities,boolean]>)
    .filter(([,ready])=>!ready).map(([name])=>name);
  return {canDraft,canRender,canQueueForApproval,canPublish,canLearn,blockers};
}
/** These defaults intentionally do not infer runtime readiness from code presence. */
export const unverifiedVideoStudioCapabilities: VideoStudioCapabilities = {
  editorialMemory:false,textGenerationApi:false,licensedMedia:false,editorSchemaVerified:false,
  rendererReachable:false,voiceReady:false,avatarReady:false,publicationConnected:false,
  analyticsConnected:false,approvalWorkflow:false
};
