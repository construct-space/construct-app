<script setup lang="ts">
// Shows a pre-accept warning when a personal developer is about to join an
// org that isn't enrolled as a publisher — their personal developer access
// goes dormant until they leave or the org enrolls. Published spaces remain
// live. Dismiss = proceed with accept; Cancel = bail out.

interface Props {
  orgName: string
  onContinue: () => void
  onCancel: () => void
}

defineProps<Props>()
</script>

<template>
  <div class="dormancy-backdrop">
    <div class="dormancy-modal">
      <h3>Pause personal developer access?</h3>
      <p>
        Joining <strong>{{ orgName }}</strong> will pause your personal
        developer access until you leave the organization or
        <strong>{{ orgName }}</strong> enrolls as a publisher.
      </p>
      <p class="dim">
        Your published spaces stay live and continue receiving downloads.
        You can resume personal developer access at any time by leaving
        the organization.
      </p>
      <div class="actions">
        <button class="secondary" @click="onCancel">Cancel</button>
        <button class="primary" @click="onContinue">Continue joining</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dormancy-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dormancy-modal {
  background: var(--bg-surface, #fff);
  color: var(--text-primary, #111);
  border-radius: 12px;
  padding: 24px;
  max-width: 480px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}
.dormancy-modal h3 {
  margin: 0 0 12px;
}
.dormancy-modal p {
  margin: 0 0 12px;
  line-height: 1.5;
}
.dormancy-modal p.dim {
  color: var(--text-secondary, #666);
  font-size: 0.92em;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.actions button {
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--border, #ddd);
  background: var(--bg, #fff);
}
.actions button.primary {
  background: var(--accent, #2563eb);
  color: #fff;
  border-color: transparent;
}
</style>
