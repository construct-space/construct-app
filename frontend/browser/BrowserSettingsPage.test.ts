import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BrowserSettingsPage from './BrowserSettingsPage.vue'
import type { BrowserSettings } from './settings'

function settingsFixture(overrides: Partial<BrowserSettings> = {}): BrowserSettings {
  return {
    homeUrl: 'https://construct.space',
    searchEngine: 'google',
    openExternalLinksInNewTab: true,
    zoomByOrigin: {},
    pinnedTabUrls: [],
    theme: 'dark',
    defaultZoom: 1,
    openDownloadsInFolder: false,
    ...overrides,
  }
}

const stubs = {
  Card: {
    name: 'Card',
    props: ['title', 'description', 'variant'],
    template: `
      <section>
        <header>
          <slot name="header" />
          <h2 v-if="title">{{ title }}</h2>
          <p v-if="description">{{ description }}</p>
          <slot name="accessory" />
        </header>
        <div>
          <slot />
        </div>
        <footer>
          <slot name="footer" />
          <slot name="footer-end" />
        </footer>
      </section>
    `,
  },
  Button: {
    name: 'Button',
    props: ['label', 'variant', 'size'],
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\', $event)"><slot name="leading" />{{ label }}<slot /></button>',
  },
  Input: {
    name: 'Input',
    props: ['modelValue', 'placeholder', 'size'],
    emits: ['update:modelValue', 'blur'],
    template: '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'blur\', $event)" />',
  },
  Select: {
    name: 'Select',
    props: ['modelValue', 'options', 'placeholder', 'size'],
    emits: ['update:modelValue'],
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
  },
  Slider: {
    name: 'Slider',
    props: ['modelValue', 'min', 'max', 'step', 'size'],
    emits: ['update:modelValue'],
    template: '<input type="range" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
  Switch: {
    name: 'Switch',
    props: ['modelValue', 'size'],
    emits: ['update:modelValue'],
    template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
  },
}

function mountPage(settings = settingsFixture()) {
  return mount(BrowserSettingsPage, {
    props: {
      profileName: 'Flakerim Ismani',
      settings,
    },
    global: { stubs },
  })
}

describe('BrowserSettingsPage', () => {
  it('renders the settings surface with Construct UI panels', () => {
    const wrapper = mountPage()

    expect(wrapper.find('[data-testid="browser-settings-shell"]').exists()).toBe(true)
    expect(wrapper.findAllComponents({ name: 'Card' })).toHaveLength(3)
    expect(wrapper.findAll('.browser-settings__panel')).toHaveLength(3)
    expect(wrapper.text()).toContain('Browser settings')
    expect(wrapper.text()).toContain('Appearance')
    expect(wrapper.text()).toContain('Navigation')
    expect(wrapper.text()).toContain('Behavior')
  })

  it('emits a full settings update when Construct UI controls change', async () => {
    const wrapper = mountPage()
    const selects = wrapper.findAllComponents({ name: 'Select' })
    const slider = wrapper.findComponent({ name: 'Slider' })

    expect(selects).toHaveLength(2)

    selects[0].vm.$emit('update:modelValue', 'light')
    await nextTick()
    expect(wrapper.emitted('update:settings')?.at(-1)?.[0]).toMatchObject({
      homeUrl: 'https://construct.space',
      theme: 'light',
      searchEngine: 'google',
    })

    slider.vm.$emit('update:modelValue', 1.2)
    await nextTick()
    expect(wrapper.emitted('update:settings')?.at(-1)?.[0]).toMatchObject({
      defaultZoom: 1.2,
      theme: 'light',
    })
  })

  it('commits the home page field on focusout', async () => {
    const wrapper = mountPage()

    const input = wrapper.findComponent({ name: 'Input' })
    input.vm.$emit('update:modelValue', ' https://example.com ')
    await nextTick()

    expect(wrapper.emitted('update:settings')).toBeUndefined()

    await input.find('input').trigger('focusout')

    expect(wrapper.emitted('update:settings')?.at(-1)?.[0]).toMatchObject({
      homeUrl: 'https://example.com',
    })
  })
})
