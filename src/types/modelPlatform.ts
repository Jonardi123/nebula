export type ModelArtifactFormat = 'gguf' | 'safetensors' | 'unknown'
export type ModelRuntimeKind = 'lmstudio' | 'llamacpp' | 'ollama' | 'cloud' | 'custom'
export type ModelDownloadState = 'queued' | 'downloading' | 'paused' | 'verifying' | 'complete' | 'failed' | 'cancelled'

export interface HardwareRequirements {
  ramBytes?: number
  vramBytes?: number
  storageBytes?: number
  contextLength?: number
  estimatedTokensPerSecond?: { min: number; max: number }
}

export interface ModelArtifact {
  id: string
  modelId: string
  fileName: string
  format: ModelArtifactFormat
  quantization?: string
  sizeBytes?: number
  sha256?: string
  sourceUrl?: string
  localPath?: string
  requirements?: HardwareRequirements
}

export interface PlatformModel {
  id: string
  displayName: string
  publisher?: string
  description?: string
  capabilities: string[]
  artifacts: ModelArtifact[]
  installedArtifactIds: string[]
  recommended?: boolean
  officialNebulaModel?: boolean
  updatedAt?: string
}

export interface RuntimeModelState {
  modelId: string
  artifactId?: string
  loaded: boolean
  loading: boolean
  contextLength?: number
  memoryBytes?: number
  error?: string
}

export interface RuntimeHealth {
  online: boolean
  version?: string
  message?: string
  capabilities: string[]
}

export interface RuntimeInferenceRequest {
  modelId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>
  temperature?: number
  maxTokens?: number
  tools?: unknown[]
}

export interface RuntimeInferenceResult {
  content: string
  finishReason?: string
  promptTokens?: number
  completionTokens?: number
  firstTokenMs?: number
  totalMs?: number
}

export interface RuntimeAdapter {
  readonly id: string
  readonly label: string
  readonly kind: ModelRuntimeKind
  health(signal?: AbortSignal): Promise<RuntimeHealth>
  listModels(signal?: AbortSignal): Promise<RuntimeModelState[]>
  importModel?(artifact: ModelArtifact, signal?: AbortSignal): Promise<RuntimeModelState>
  load(modelId: string, options?: { contextLength?: number; signal?: AbortSignal }): Promise<RuntimeModelState>
  unload(modelId: string, signal?: AbortSignal): Promise<void>
  infer(request: RuntimeInferenceRequest, signal?: AbortSignal): Promise<RuntimeInferenceResult>
  stream?(request: RuntimeInferenceRequest, onToken: (token: string) => void, signal?: AbortSignal): Promise<RuntimeInferenceResult>
  cancel?(): Promise<void> | void
}

export interface ModelCatalog {
  search(query: string, options?: { cursor?: string; limit?: number; signal?: AbortSignal }): Promise<{
    models: PlatformModel[]
    nextCursor?: string
  }>
  getModel(id: string, signal?: AbortSignal): Promise<PlatformModel | null>
}

export interface ModelDownloadTask {
  id: string
  artifact: ModelArtifact
  state: ModelDownloadState
  bytesDownloaded: number
  totalBytes?: number
  error?: string
  createdAt: string
  updatedAt: string
}

export interface ModelDownloadManager {
  list(): Promise<ModelDownloadTask[]>
  enqueue(artifact: ModelArtifact): Promise<ModelDownloadTask>
  pause(taskId: string): Promise<void>
  resume(taskId: string): Promise<void>
  cancel(taskId: string): Promise<void>
  verify(taskId: string): Promise<boolean>
  remove(taskId: string, options?: { deleteFile?: boolean }): Promise<void>
}
