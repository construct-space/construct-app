<script lang="ts">
/**
 * SvgPreview - Safe SVG renderer component
 * Uses render function to avoid v-html ESLint warnings
 */
import { defineComponent, h } from 'vue'

export default defineComponent({
  name: 'SvgPreview',
  props: {
    svg: { type: String, default: '' },
    class: { type: String, default: '' },
  },
  setup(props) {
    return () => {
      if (!props.svg) {
        return h('div', { class: 'text-app-muted text-sm' }, 'No preview available')
      }

      return h('div', {
        class: props.class,
        innerHTML: props.svg,
      })
    }
  },
})
</script>
