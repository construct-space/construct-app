import { useAuthStore } from '@/stores/auth'
import { useNotification, type Notification } from '@/composables/useNotification'

type ToastColor = NonNullable<Notification['color']>
type ToastOptions = Omit<Notification, 'id' | 'title' | 'color'>
// Two call styles, both supported: the SDK-typed object form
// `toast.x(title, { description })` and the legacy positional
// `toast.x(title, 'description')`. The object form was previously stringified
// into the description (showing raw JSON), so it's handled explicitly here.
type ToastFn = (title: string, descriptionOrOptions?: string | ToastOptions, options?: Omit<Notification, 'id' | 'title' | 'description' | 'color'>) => string

type RefLikeObject<T> = {
  readonly value: T
} & NonNullable<T>

function makeObjectRef<T extends Record<string, unknown> | null | undefined>(
  getValue: () => T,
): RefLikeObject<T> {
  const source = {
    __v_isRef: true as const,
    get value() {
      return getValue()
    },
  }
  return new Proxy(source, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver)
      }
      const value = target.value as Record<PropertyKey, unknown> | null | undefined
      return value?.[prop]
    },
    has(target, prop) {
      if (prop in target) return true
      const value = target.value as Record<PropertyKey, unknown> | null | undefined
      return !!value && prop in value
    },
  }) as unknown as RefLikeObject<T>
}

function createToastMethod(color: ToastColor): ToastFn {
  return (title, descriptionOrOptions, options) => {
    const notifications = useNotification()
    const opts: ToastOptions = (descriptionOrOptions && typeof descriptionOrOptions === 'object')
      ? descriptionOrOptions
      : { ...(options || {}), description: descriptionOrOptions }
    return notifications.add({
      ...opts,
      title,
      color,
    })
  }
}

export function useToast() {
  const notifications = useNotification()
  const toast = {
    success: createToastMethod('success'),
    error: createToastMethod('error'),
    warning: createToastMethod('warning'),
    info: createToastMethod('info'),
  }

  return {
    ...notifications,
    ...toast,
    toast,
  }
}

export function useAuth() {
  const store = useAuthStore()
  const user = makeObjectRef(() => store.user)

  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'user') return user
      return Reflect.get(target, prop, receiver)
    },
  }) as typeof store & { user: RefLikeObject<typeof store.user> }
}
