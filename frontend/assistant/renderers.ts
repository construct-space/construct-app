import { type Component, defineAsyncComponent } from 'vue'
import { getAssistantType } from './registry'

// Accepts either an eager Component or a lazy () => import('...') function
type ComponentOrLazy = Component | (() => Promise<{ default: Component }>)

// Block renderer registry: maps "spaceId:blockType" -> Vue component
const blockRenderers = new Map<string, Component>()

// Register a custom block renderer for a namespaced block type.
// Accepts an eager component or a lazy import function.
export function registerBlockRenderer(blockType: `${string}:${string}`, component: ComponentOrLazy) {
  if (typeof component === 'function' && component.length === 0) {
    // Lazy import — wrap with defineAsyncComponent
    blockRenderers.set(blockType, defineAsyncComponent(component as () => Promise<{ default: Component }>))
  }
  else {
    blockRenderers.set(blockType, component as Component)
  }
}

// Resolve renderer for a block type
export function resolveBlockRenderer(blockType: string): Component | undefined {
  return blockRenderers.get(blockType)
}

// Resolve the top-level renderer mode for an assistant type
export function resolveRendererMode(assistantTypeId: string): 'blocks' | 'timeline' | 'custom' {
  const config = getAssistantType(assistantTypeId)
  return config?.renderMode || 'blocks'
}

// Get the custom renderer component name for a 'custom' renderMode type
export function resolveCustomRenderer(assistantTypeId: string): string | undefined {
  const config = getAssistantType(assistantTypeId)
  return config?.customRenderer
}
