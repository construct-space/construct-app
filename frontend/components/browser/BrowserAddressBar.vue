<script setup lang="ts">
import { ref, watch } from "vue";
import BrowserSuggestionsDropdown from "./BrowserSuggestionsDropdown.vue";

interface Suggestion {
  id: string;
  title: string;
  url: string;
  source: "history" | "bookmark" | "url-completion";
  icon?: string;
  score: number;
}

const props = withDefaults(
  defineProps<{
    address: string;
    disabled?: boolean;
    loading?: boolean;
  }>(),
  { disabled: false, loading: false }
);

const emit = defineEmits<{
  submit: [url: string];
  "update:address": [url: string];
}>();

const input = ref<HTMLInputElement | null>(null);
const localAddress = ref("");
const showSuggestions = ref(false);
const suggestions = ref<Suggestion[]>([]);
const focused = ref(false);

watch(
  () => props.address,
  (newVal) => {
    if (focused.value) return;
    localAddress.value = newVal;
  },
  { immediate: true }
);

function onFocus() {
  focused.value = true;
  updateSuggestions();
}

function onBlur() {
  focused.value = false;
  setTimeout(() => {
    showSuggestions.value = false;
  }, 100);
}

function onInput(event: Event) {
  localAddress.value = event.target instanceof HTMLInputElement
    ? event.target.value
    : localAddress.value;
  emit("update:address", localAddress.value);
  updateSuggestions();
}

function updateSuggestions() {
  // Placeholder - will be populated by Task 25
  suggestions.value = [];
  showSuggestions.value = localAddress.value.length > 0;
}

function selectSuggestion(suggestion: Suggestion) {
  localAddress.value = suggestion.url;
  emit("update:address", suggestion.url);
  onSubmit();
}

function onSubmit() {
  const url = localAddress.value.trim();
  if (url) {
    emit("submit", url);
    focused.value = false;
    input.value?.blur();
    showSuggestions.value = false;
  }
}

function clearFocus() {
  input.value?.blur();
}

function focusAddressBar(select = true) {
  input.value?.focus();
  if (select) {
    input.value?.select();
  }
}

defineExpose({ focusAddressBar });
</script>

<template>
  <div class="address-bar-wrapper">
    <form class="addr-form" @submit.prevent="onSubmit">
      <input
        ref="input"
        :value="localAddress"
        type="text"
        placeholder="Search or enter URL"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        :disabled="disabled"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
        @keydown.escape="clearFocus"
      />
      <div v-if="loading" class="addr-progress" />
    </form>
    <BrowserSuggestionsDropdown
      v-if="showSuggestions && suggestions.length > 0"
      :suggestions="suggestions"
      :address="localAddress"
      @select="selectSuggestion"
      @close="showSuggestions = false"
    />
  </div>
</template>

<style scoped>
.address-bar-wrapper {
  position: relative;
  flex: 1;
  min-width: 200px;
}

.addr-form {
  flex: 1;
  display: flex;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.addr-form input {
  width: 100%;
  padding: 7px 14px;
  border-radius: 18px;
  background: var(--app-input-bg);
  border: 1px solid var(--app-border);
  color: var(--app-foreground);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  user-select: text;
  -webkit-user-select: text;
  transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}

.addr-form input:hover {
  border-color: color-mix(in srgb, var(--app-foreground) 18%, transparent);
}

.addr-form input:focus {
  background: var(--app-background);
  border-color: var(--app-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 22%, transparent);
}

.addr-form {
  position: relative;
}

.addr-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--app-accent) 60%, transparent), var(--app-accent));
  border-radius: 1px;
  animation: progress-indeterminate 1.5s ease-in-out infinite;
}

@keyframes progress-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(100%);
  }
  100% {
    transform: translateX(-100%);
  }
}
</style>
