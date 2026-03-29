<script setup lang="ts">
defineProps<{
  data: { message: string }
}>()
</script>

<template>
  <div class="architect-progress">
    <p>{{ data.message }}</p>
  </div>
</template>
