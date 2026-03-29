<script setup lang="ts">
defineProps<{
  data: {
    title: string
    summary: string
    decisions: Array<{ label: string; value: string }>
    docs: Array<{ path: string; title: string }>
    nextActions: Array<{ id: string; label: string }>
  }
}>()
</script>

<template>
  <div class="architect-plan">
    <h3>{{ data.title }}</h3>
    <p>{{ data.summary }}</p>
    <div v-if="data.decisions.length" class="decisions">
      <h4>Decisions</h4>
      <div v-for="d in data.decisions" :key="d.label" class="decision">
        <strong>{{ d.label }}:</strong> {{ d.value }}
      </div>
    </div>
    <div v-if="data.docs.length" class="docs">
      <h4>Documents</h4>
      <div v-for="doc in data.docs" :key="doc.path">{{ doc.title }}</div>
    </div>
    <div v-if="data.nextActions.length" class="actions">
      <button v-for="action in data.nextActions" :key="action.id">{{ action.label }}</button>
    </div>
  </div>
</template>
