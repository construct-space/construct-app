export type * from './blocks'
export { extractQuestion } from './blocks'
export {
  assistantContentBlockSchema,
  assistantEnvelopeSchema,
  tryParseAssistantEnvelope,
} from './schema'
export type {
  AssistantContentBlock,
  AssistantEnvelope,
} from './schema'
export { normalizeAssistantEnvelope, normalize } from './normalize'
export type {
  AssistantTypeId,
  BuiltinAssistantTypeId,
  AssistantTypeConfig,
  NormalizerFn,
} from './types'
export {
  registerAssistantType,
  getAssistantType,
  listAssistantTypes,
  unregisterAssistantTypesBySource,
} from './registry'
export { loadCoreAssistantTypes, registerCoreBlockRenderers } from './loader'
export { resolveAssistantType, getAssistantConfig } from './runtime'
export {
  registerBlockRenderer,
  resolveBlockRenderer,
  resolveRendererMode,
  resolveCustomRenderer,
} from './renderers'

// Register core space assistant types and block renderers at module load
import { loadCoreAssistantTypes, registerCoreBlockRenderers } from './loader'
loadCoreAssistantTypes()
registerCoreBlockRenderers()
