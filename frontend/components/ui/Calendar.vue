<script setup lang="ts">
/**
 * Calendar - Month/Week/Day calendar view
 * Apple Calendar inspired, clean minimal aesthetic
 * Supports v-model for selected date, v-model:view for view mode
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

export interface CalendarEvent {
  id: string | number
  title: string
  start: Date
  end: Date
  color?: string
  allDay?: boolean
}

type CalendarView = 'month' | 'week' | 'day'

const props = withDefaults(defineProps<{
  modelValue?: Date
  view?: CalendarView
  events?: CalendarEvent[]
  weekStartsOn?: 0 | 1
}>(), {
  modelValue: () => new Date(),
  view: 'month',
  events: () => [],
  weekStartsOn: 1,
})

const emit = defineEmits<{
  'update:modelValue': [date: Date]
  'update:view': [view: CalendarView]
  'select-date': [date: Date]
  'select-range': [range: { start: Date; end: Date }]
  'create-event': [payload: { date: Date; hour?: number }]
}>()

defineSlots<{
  event?: (props: { event: CalendarEvent }) => unknown
}>()

const now = ref(new Date())
let nowTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  nowTimer = setInterval(() => {
    now.value = new Date()
  }, 60_000)
})

onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer)
})

const selectedDate = computed({
  get: () => props.modelValue,
  set: (v: Date) => emit('update:modelValue', v),
})

const currentView = computed({
  get: () => props.view,
  set: (v: CalendarView) => emit('update:view', v),
})

// Navigation reference date (month/week being displayed)
const viewDate = ref(new Date(props.modelValue))

watch(() => props.modelValue, (d) => {
  viewDate.value = new Date(d)
})

// --- Date helpers ---

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function isToday(d: Date): boolean {
  return isSameDay(d, now.value)
}

function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function formatWeekRange(d: Date): string {
  const start = getWeekStart(d)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}, ${end.getFullYear()}`
  }
  return `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
}

function formatDayHeader(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function getWeekStart(d: Date): Date {
  const result = new Date(d)
  const day = result.getDay()
  const diff = (day - props.weekStartsOn + 7) % 7
  result.setDate(result.getDate() - diff)
  result.setHours(0, 0, 0, 0)
  return result
}

const headerTitle = computed(() => {
  if (currentView.value === 'month') return formatMonth(viewDate.value)
  if (currentView.value === 'week') return formatWeekRange(viewDate.value)
  return formatDayHeader(viewDate.value)
})

// --- Navigation ---

function navigate(direction: -1 | 1) {
  const d = new Date(viewDate.value)
  if (currentView.value === 'month') {
    d.setMonth(d.getMonth() + direction)
  } else if (currentView.value === 'week') {
    d.setDate(d.getDate() + direction * 7)
  } else {
    d.setDate(d.getDate() + direction)
  }
  viewDate.value = d
}

function goToday() {
  const today = new Date()
  viewDate.value = today
  selectedDate.value = today
  emit('select-date', today)
}

// --- Month view ---

const WEEKDAY_LABELS = computed(() => {
  const labels: string[] = []
  const base = new Date(2024, 0, props.weekStartsOn) // Jan 2024, Mon=1
  // Find the correct starting day
  while (base.getDay() !== props.weekStartsOn) base.setDate(base.getDate() + 1)
  for (let i = 0; i < 7; i++) {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }))
  }
  return labels
})

interface MonthDay {
  date: Date
  isCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  isWeekend: boolean
  events: CalendarEvent[]
}

const monthGrid = computed((): MonthDay[][] => {
  const year = viewDate.value.getFullYear()
  const month = viewDate.value.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth = new Date(year, month + 1, 0)

  const startDay = getWeekStart(firstOfMonth)
  const weeks: MonthDay[][] = []
  const cursor = new Date(startDay)

  for (let w = 0; w < 6; w++) {
    const week: MonthDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(cursor)
      week.push({
        date,
        isCurrentMonth: date.getMonth() === month,
        isToday: isToday(date),
        isSelected: isSameDay(date, selectedDate.value),
        isWeekend: isWeekend(date),
        events: getEventsForDay(date),
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    // Stop if we've gone past the month and completed the week
    if (cursor.getMonth() !== month && cursor.getDay() === props.weekStartsOn) break
  }
  return weeks
})

// --- Week view ---

const weekDays = computed(() => {
  const start = getWeekStart(viewDate.value)
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    days.push(d)
  }
  return days
})

// --- Event helpers ---

function getEventsForDay(date: Date): CalendarEvent[] {
  return props.events.filter((e) => {
    const start = new Date(e.start)
    const end = new Date(e.end)
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(date)
    dayEnd.setHours(23, 59, 59, 999)
    return start <= dayEnd && end >= dayStart
  })
}

function getEventsForHour(date: Date, hour: number): CalendarEvent[] {
  return props.events.filter((e) => {
    if (e.allDay) return false
    const start = new Date(e.start)
    const end = new Date(e.end)
    const hourStart = new Date(date)
    hourStart.setHours(hour, 0, 0, 0)
    const hourEnd = new Date(date)
    hourEnd.setHours(hour, 59, 59, 999)
    return start <= hourEnd && end >= hourStart && isSameDay(start, date)
  })
}

function getAllDayEvents(date: Date): CalendarEvent[] {
  return props.events.filter((e) => {
    if (!e.allDay) return false
    const start = new Date(e.start)
    const end = new Date(e.end)
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(date)
    dayEnd.setHours(23, 59, 59, 999)
    return start <= dayEnd && end >= dayStart
  })
}

// --- Current time ---

const currentTimeTop = computed(() => {
  const h = now.value.getHours()
  const m = now.value.getMinutes()
  return ((h * 60 + m) / (24 * 60)) * 100
})

const hours = Array.from({ length: 24 }, (_, i) => i)

function formatHour(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

// --- Interactions ---

function selectDay(date: Date) {
  selectedDate.value = date
  emit('select-date', date)
}

function handleDayDoubleClick(date: Date, hour?: number) {
  emit('create-event', { date, hour })
}

// --- Range selection ---
const rangeStart = ref<Date | null>(null)
const rangeEnd = ref<Date | null>(null)

function handleMouseDown(date: Date) {
  rangeStart.value = date
  rangeEnd.value = null
}

function handleMouseEnter(date: Date) {
  if (rangeStart.value) {
    rangeEnd.value = date
  }
}

function handleMouseUp(date: Date) {
  if (rangeStart.value) {
    const start = rangeStart.value < date ? rangeStart.value : date
    const end = rangeStart.value < date ? date : rangeStart.value
    if (!isSameDay(start, end)) {
      emit('select-range', { start, end })
    }
    rangeStart.value = null
    rangeEnd.value = null
  }
}

function isInRange(date: Date): boolean {
  if (!rangeStart.value || !rangeEnd.value) return false
  const start = rangeStart.value < rangeEnd.value ? rangeStart.value : rangeEnd.value
  const end = rangeStart.value < rangeEnd.value ? rangeEnd.value : rangeStart.value
  return date >= start && date <= end
}

function eventColor(event: CalendarEvent): string {
  return event.color || 'var(--app-accent)'
}
</script>

<template>
  <div class="flex flex-col h-full select-none" style="color: var(--app-foreground); background: var(--app-background);">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b" style="border-color: var(--app-border);">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-semibold tracking-tight">{{ headerTitle }}</h2>
      </div>

      <div class="flex items-center gap-2">
        <!-- View switcher -->
        <div class="flex rounded-lg p-0.5 text-xs font-medium" style="background: color-mix(in srgb, var(--app-muted) 15%, transparent);">
          <button
            v-for="v in (['month', 'week', 'day'] as const)"
            :key="v"
            class="px-2.5 py-1 rounded-md capitalize transition-all duration-150 cursor-pointer"
            :style="currentView === v
              ? 'background: var(--app-accent); color: white;'
              : 'color: var(--app-foreground); opacity: 0.7;'"
            @click="currentView = v"
          >
            {{ v }}
          </button>
        </div>

        <!-- Navigation -->
        <div class="flex items-center gap-1 ml-2">
          <button
            class="p-1.5 rounded-md transition-colors duration-150 cursor-pointer hover:opacity-80"
            style="color: var(--app-foreground);"
            @click="navigate(-1)"
            aria-label="Previous"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button
            class="px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer"
            style="color: var(--app-accent);"
            @click="goToday"
          >
            Today
          </button>
          <button
            class="p-1.5 rounded-md transition-colors duration-150 cursor-pointer hover:opacity-80"
            style="color: var(--app-foreground);"
            @click="navigate(1)"
            aria-label="Next"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Month View -->
    <div v-if="currentView === 'month'" class="flex-1 flex flex-col overflow-hidden">
      <!-- Weekday headers -->
      <div class="grid grid-cols-7 text-xs font-medium py-2 px-1 border-b" style="color: var(--app-muted); border-color: var(--app-border);">
        <div v-for="label in WEEKDAY_LABELS" :key="label" class="text-center">{{ label }}</div>
      </div>

      <!-- Days grid -->
      <div class="flex-1 grid auto-rows-fr">
        <div
          v-for="(week, wi) in monthGrid"
          :key="wi"
          class="grid grid-cols-7 border-b last:border-b-0"
          style="border-color: var(--app-border);"
        >
          <div
            v-for="(day, di) in week"
            :key="di"
            class="relative px-1 py-1 min-h-[72px] border-r last:border-r-0 transition-colors duration-100 cursor-pointer"
            :style="{
              borderColor: 'var(--app-border)',
              background: isInRange(day.date)
                ? 'color-mix(in srgb, var(--app-accent) 8%, transparent)'
                : day.isWeekend
                  ? 'color-mix(in srgb, var(--app-muted) 5%, transparent)'
                  : 'transparent',
            }"
            @click="selectDay(day.date)"
            @dblclick="handleDayDoubleClick(day.date)"
            @mousedown="handleMouseDown(day.date)"
            @mouseenter="handleMouseEnter(day.date)"
            @mouseup="handleMouseUp(day.date)"
          >
            <!-- Day number -->
            <div class="flex items-center justify-center">
              <span
                class="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-all duration-150"
                :style="{
                  background: day.isToday
                    ? 'var(--app-accent)'
                    : day.isSelected
                      ? 'color-mix(in srgb, var(--app-accent) 15%, transparent)'
                      : 'transparent',
                  color: day.isToday
                    ? 'white'
                    : day.isSelected
                      ? 'var(--app-accent)'
                      : day.isCurrentMonth
                        ? 'var(--app-foreground)'
                        : 'var(--app-muted)',
                  fontWeight: day.isToday ? '600' : '400',
                }"
              >
                {{ day.date.getDate() }}
              </span>
            </div>

            <!-- Events -->
            <div class="mt-0.5 space-y-0.5 overflow-hidden">
              <template v-for="event in day.events.slice(0, 3)" :key="event.id">
                <slot name="event" :event="event">
                  <div
                    class="text-[10px] leading-tight px-1.5 py-0.5 rounded truncate font-medium"
                    :style="{
                      background: `color-mix(in srgb, ${eventColor(event)} 15%, transparent)`,
                      color: eventColor(event),
                    }"
                  >
                    {{ event.title }}
                  </div>
                </slot>
              </template>
              <div
                v-if="day.events.length > 3"
                class="text-[10px] px-1.5 font-medium"
                style="color: var(--app-muted);"
              >
                +{{ day.events.length - 3 }} more
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Week View -->
    <div v-else-if="currentView === 'week'" class="flex-1 flex flex-col overflow-hidden">
      <!-- Day headers -->
      <div class="grid border-b" style="grid-template-columns: 56px repeat(7, 1fr); border-color: var(--app-border);">
        <div class="border-r" style="border-color: var(--app-border);"></div>
        <div
          v-for="(day, i) in weekDays"
          :key="i"
          class="text-center py-2 border-r last:border-r-0"
          :style="{
            borderColor: 'var(--app-border)',
            background: isWeekend(day) ? 'color-mix(in srgb, var(--app-muted) 5%, transparent)' : 'transparent',
          }"
        >
          <div class="text-[10px] font-medium uppercase tracking-wider" style="color: var(--app-muted);">
            {{ day.toLocaleDateString('en-US', { weekday: 'short' }) }}
          </div>
          <div
            class="inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium mt-0.5"
            :style="{
              background: isToday(day) ? 'var(--app-accent)' : isSameDay(day, selectedDate) ? 'color-mix(in srgb, var(--app-accent) 15%, transparent)' : 'transparent',
              color: isToday(day) ? 'white' : isSameDay(day, selectedDate) ? 'var(--app-accent)' : 'var(--app-foreground)',
            }"
            @click="selectDay(day)"
          >
            {{ day.getDate() }}
          </div>

          <!-- All-day events -->
          <div v-if="getAllDayEvents(day).length" class="px-1 mt-1 space-y-0.5">
            <div
              v-for="event in getAllDayEvents(day)"
              :key="event.id"
              class="text-[10px] leading-tight px-1.5 py-0.5 rounded truncate font-medium"
              :style="{
                background: `color-mix(in srgb, ${eventColor(event)} 15%, transparent)`,
                color: eventColor(event),
              }"
            >
              {{ event.title }}
            </div>
          </div>
        </div>
      </div>

      <!-- Time grid -->
      <div class="flex-1 overflow-y-auto relative">
        <div class="grid min-h-[1440px]" style="grid-template-columns: 56px repeat(7, 1fr);">
          <!-- Time labels -->
          <div class="relative border-r" style="border-color: var(--app-border);">
            <div
              v-for="hour in hours"
              :key="hour"
              class="h-[60px] text-right pr-2 text-[10px] font-medium -translate-y-1.5"
              style="color: var(--app-muted);"
            >
              {{ hour === 0 ? '' : formatHour(hour) }}
            </div>
          </div>

          <!-- Day columns -->
          <div
            v-for="(day, di) in weekDays"
            :key="di"
            class="relative border-r last:border-r-0"
            :style="{
              borderColor: 'var(--app-border)',
              background: isWeekend(day) ? 'color-mix(in srgb, var(--app-muted) 5%, transparent)' : 'transparent',
            }"
          >
            <!-- Hour rows -->
            <div
              v-for="hour in hours"
              :key="hour"
              class="h-[60px] border-b relative"
              style="border-color: color-mix(in srgb, var(--app-border) 50%, transparent);"
              @dblclick="handleDayDoubleClick(day, hour)"
            >
              <!-- Events in this hour -->
              <div
                v-for="event in getEventsForHour(day, hour)"
                :key="event.id"
                class="absolute inset-x-0.5 top-0.5 z-10"
              >
                <slot name="event" :event="event">
                  <div
                    class="text-[10px] leading-tight px-1.5 py-1 rounded font-medium truncate"
                    :style="{
                      background: `color-mix(in srgb, ${eventColor(event)} 18%, transparent)`,
                      color: eventColor(event),
                      borderLeft: `2px solid ${eventColor(event)}`,
                    }"
                  >
                    {{ event.title }}
                  </div>
                </slot>
              </div>
            </div>

            <!-- Current time indicator -->
            <div
              v-if="isToday(day)"
              class="absolute left-0 right-0 z-20 pointer-events-none"
              :style="{ top: currentTimeTop + '%' }"
            >
              <div class="flex items-center">
                <div class="w-2 h-2 rounded-full -ml-1" style="background: var(--app-accent);"></div>
                <div class="flex-1 h-[1.5px]" style="background: var(--app-accent);"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Day View -->
    <div v-else class="flex-1 flex flex-col overflow-hidden">
      <!-- All-day events bar -->
      <div
        v-if="getAllDayEvents(viewDate).length"
        class="px-4 py-2 border-b flex gap-2 flex-wrap"
        style="border-color: var(--app-border);"
      >
        <div
          v-for="event in getAllDayEvents(viewDate)"
          :key="event.id"
          class="text-xs px-2 py-1 rounded font-medium"
          :style="{
            background: `color-mix(in srgb, ${eventColor(event)} 15%, transparent)`,
            color: eventColor(event),
          }"
        >
          {{ event.title }}
        </div>
      </div>

      <!-- Time grid -->
      <div class="flex-1 overflow-y-auto relative">
        <div class="grid min-h-[1440px]" style="grid-template-columns: 56px 1fr;">
          <!-- Time labels -->
          <div class="relative border-r" style="border-color: var(--app-border);">
            <div
              v-for="hour in hours"
              :key="hour"
              class="h-[60px] text-right pr-2 text-[10px] font-medium -translate-y-1.5"
              style="color: var(--app-muted);"
            >
              {{ hour === 0 ? '' : formatHour(hour) }}
            </div>
          </div>

          <!-- Single day column -->
          <div class="relative">
            <!-- Hour rows -->
            <div
              v-for="hour in hours"
              :key="hour"
              class="h-[60px] border-b relative"
              style="border-color: color-mix(in srgb, var(--app-border) 50%, transparent);"
              @dblclick="handleDayDoubleClick(viewDate, hour)"
            >
              <!-- Events in this hour -->
              <div
                v-for="event in getEventsForHour(viewDate, hour)"
                :key="event.id"
                class="absolute inset-x-1 top-0.5 z-10"
              >
                <slot name="event" :event="event">
                  <div
                    class="text-xs leading-tight px-2 py-1.5 rounded font-medium"
                    :style="{
                      background: `color-mix(in srgb, ${eventColor(event)} 18%, transparent)`,
                      color: eventColor(event),
                      borderLeft: `3px solid ${eventColor(event)}`,
                    }"
                  >
                    <div>{{ event.title }}</div>
                    <div class="opacity-70 text-[10px] mt-0.5">
                      {{ new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }}
                      –
                      {{ new Date(event.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }}
                    </div>
                  </div>
                </slot>
              </div>
            </div>

            <!-- Current time indicator -->
            <div
              v-if="isToday(viewDate)"
              class="absolute left-0 right-0 z-20 pointer-events-none"
              :style="{ top: currentTimeTop + '%' }"
            >
              <div class="flex items-center">
                <div class="w-2.5 h-2.5 rounded-full -ml-1" style="background: var(--app-accent);"></div>
                <div class="flex-1 h-[2px]" style="background: var(--app-accent);"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
