/**
 * SDK Types — Shared authoring types for space developers.
 *
 * These types are the contract between the host app and space bundles.
 * Space authors import them from '@construct/sdk' or '@construct-space/sdk'.
 *
 * This file re-exports canonical types from their source modules so there
 * is a single import point for space authoring.
 */

// ── Space manifest (from SpaceLoader) ──
export type { SpaceManifest, LoadedSpace } from '@/space_loader/SpaceLoader'

// ── Toolbar types (from useToolbar composable) ──
export type { ToolbarItem, ToolbarBreadcrumb } from '@/composables/useToolbar'

// ── Space toolbar types (from useSpaces composable) ──
export type { SpaceToolbarItem, SpacePage, SpaceConfig } from '@/composables/useSpaces'

// ── Assistant block types (from assistant module) ──
export type {
  Turn,
  RequestBlock,
  ResponseBlock,
  TextBlock,
  ImageBlock,
  FileBlock,
  ToolBlock,
  CodeBlock,
  SvgBlock,
  ErrorBlock,
  StatusBlock,
  QuestionBlock,
  PlanBlock,
  TaskListBlock,
  ProgressBlock,
  TableBlock,
  JsonBlock,
  ActionBlock,
  LinkBlock,
  DiffBlock,
  CustomBlock,
} from '@/assistant/blocks'

// ── Assistant config types ──
export type {
  AssistantTypeId,
  BuiltinAssistantTypeId,
  AssistantTypeConfig,
  NormalizerFn,
} from '@/assistant/types'

// ── Operator protocol types ──
export type {
  OperatorAgent,
  DispatchResult,
  ChatResult,
  StreamEvent,
  Tool,
  ToolCall,
  ToolResult,
  ProjectContext,
  ComponentContext,
  Mode,
} from '@/brain/types'

// ── Stream event types ──
export type {
  ToolCallEvent,
  ToolResultEvent,
  StatusEvent,
  TurnStartEvent,
  TurnEndEvent,
  TextEvent,
  DoneEvent,
} from '@/brain/types'

// ── Space context bus types ──
export type {
  SpaceContextPayload,
  SpaceContextCallback,
  ContextHandler,
  AutomationProvider,
  SpaceSnapshot,
  AutomationAction,
  ActionResult,
} from '@/lib/spaceContextBus'
