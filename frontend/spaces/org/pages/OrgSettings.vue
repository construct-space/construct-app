<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, Building2, Gauge, ShieldAlert, ShieldCheck, UsersRound } from 'lucide-vue-next'
import { Button, Card, Empty, Input, Switch } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useAuthStore } from '@/stores/auth'
import { useOrgStore } from '@/stores/org'
import { useSource } from '@/composables/useSource'

const router = useRouter()
const authStore = useAuthStore()
const store = useOrgStore()
const api = useSource()
const {
  isEnabled,
  orgName,
  org,
  stats,
  members,
  disableOrg,
} = useOrgData()

// Current user's role in the org
const currentMember = computed(() => {
  const userId = authStore.user?.id
  if (!userId) return null
  return members.value.find(m => m.user_id === userId) ?? null
})

const isAdmin = computed(() => {
  const role = currentMember.value?.role
  return role === 'owner' || role === 'admin'
})

const isOwner = computed(() => currentMember.value?.role === 'owner')

const editingName = ref(false)
const nameInput = ref('')
const confirmDisable = ref(false)
const disableConfirmText = ref('')

function startEditName() {
  nameInput.value = orgName.value
  editingName.value = true
}

async function saveName() {
  const name = nameInput.value.trim()
  if (!name) return
  await store.updateOrg({ name })
  editingName.value = false
}

// --- Org Settings (key/value) ---
const allowMemberOauth = ref(true)
const savingOauth = ref(false)

async function loadOrgSettings() {
  try {
    const settings = await api.get<Record<string, string>>('/org/settings')
    if (settings && typeof settings === 'object') {
      allowMemberOauth.value = settings.allow_member_oauth !== 'false'
    }
  } catch { /* default to true */ }
}

async function toggleMemberOauth() {
  savingOauth.value = true
  const newVal = !allowMemberOauth.value
  try {
    await api.put(`/org/settings/allow_member_oauth`, { value: String(newVal) })
    allowMemberOauth.value = newVal
  } catch { /* revert on error */ }
  finally {
    savingOauth.value = false
  }
}

onMounted(() => {
  if (isAdmin.value) loadOrgSettings()
})

async function handleDisable() {
  if (disableConfirmText.value !== orgName.value) return
  await disableOrg()
  // Resync auth scope so org-gated UI (sidebar, settings) reacts without
  // a manual reload before we navigate away.
  await authStore.refreshScope()
  confirmDisable.value = false
  disableConfirmText.value = ''
  router.push('/app/org')
}

const createdLabel = computed(() => {
  if (!org.value) return ''
  return new Date(org.value.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
})
</script>

<template>
  <div class="p-6 space-y-4">
    <!-- Not enabled -->
    <Card v-if="!isEnabled">
      <Empty
        icon="i-lucide-building-2"
        title="Organization not enabled"
        description="Enable your organization from the personal onboarding flow before configuring settings here."
      />
    </Card>

    <template v-else>
      <!-- Organization name (first row) -->
      <Card variant="muted">
        <template #header>
          <div class="flex items-start gap-3 min-w-0 flex-1">
            <Building2 class="size-5 text-[var(--app-muted)] mt-1 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-[11px] tracking-[0.18em] uppercase font-medium text-[var(--app-muted)] leading-tight">
                Organization name<span class="text-[var(--app-accent)]">.</span>
              </p>
              <h2 v-if="!editingName" class="text-[22px] font-semibold tracking-[-0.015em] leading-none text-[var(--app-foreground)] mt-2">
                {{ orgName }}<span class="text-[var(--app-accent)]">.</span>
              </h2>
            </div>
          </div>
          <div v-if="isAdmin && !editingName" class="shrink-0">
            <Button variant="ghost" size="xs" label="Edit" @click="startEditName" />
          </div>
        </template>

        <div v-if="editingName" class="flex items-center gap-2">
          <div class="flex-1">
            <Input
              v-model="nameInput"
              size="sm"
              :placeholder="orgName"
              @keydown.enter="saveName"
              @keydown.escape="editingName = false"
            />
          </div>
          <Button size="sm" label="Save" :disabled="!nameInput.trim()" @click="saveName" />
          <Button variant="ghost" size="sm" label="Cancel" @click="editingName = false" />
        </div>
      </Card>


      <!-- Usage Summary -->
      <Card>
        <template #header>
          <div class="flex items-start gap-3">
            <Gauge class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Usage summary</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">Current membership and directory counts.</p>
            </div>
          </div>
        </template>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Members</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ stats.memberCount }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Departments</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ stats.departmentCount }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Teams</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ stats.teamCount }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Pending invites</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ stats.pendingInviteCount }}</div>
          </div>
        </div>

        <template v-if="org" #footer>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Created</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ createdLabel }}</div>
          </div>
        </template>
      </Card>

      <!-- Member Policies (admin only) -->
      <Card v-if="isAdmin">
        <template #header>
          <div class="flex items-start gap-3">
            <UsersRound class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Member policies</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">Rules that apply to every member of this organization.</p>
            </div>
          </div>
        </template>

        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="text-sm text-[var(--app-foreground)]">Allow members to use own OAuth for LLM providers</div>
            <div class="text-xs text-[var(--app-muted)] mt-0.5">Members can connect their own Claude, OpenAI, GitHub Copilot, etc. accounts.</div>
          </div>
          <Switch
            :model-value="allowMemberOauth"
            size="sm"
            :disabled="savingOauth"
            @update:model-value="toggleMemberOauth"
          />
        </div>
      </Card>

      <!-- Your role (non-admin info) -->
      <Card v-if="!isAdmin" variant="muted">
        <template #header>
          <div class="flex items-start gap-3">
            <ShieldCheck class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Your role</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">
                You are a <strong class="text-[var(--app-foreground)]">{{ currentMember?.role }}</strong> in this organization. Contact an admin to change organization settings.
              </p>
            </div>
          </div>
        </template>
      </Card>

      <!-- Danger zone (owner only) -->
      <Card v-if="isOwner">
        <template #header>
          <div class="flex items-start gap-3">
            <ShieldAlert class="size-5 text-red-400 mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-red-400 leading-tight after:content-['.']">Danger zone</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">
                Deleting the organization permanently removes all members, departments, teams, invitations, and activity data. This action cannot be undone.
              </p>
            </div>
          </div>
        </template>
        <template v-if="!confirmDisable" #accessory>
          <Button variant="ghost" color="error" size="xs" label="Delete organization" @click="confirmDisable = true">
            <template #leading>
              <AlertTriangle class="size-3.5" />
            </template>
          </Button>
        </template>

        <template v-if="confirmDisable">
          <div class="space-y-3">
            <p class="text-sm text-[var(--app-muted)]">
              Type <strong class="text-[var(--app-foreground)]">{{ orgName }}</strong> to confirm.
            </p>
            <Input v-model="disableConfirmText" size="sm" :placeholder="orgName" />
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                label="Cancel"
                @click="confirmDisable = false; disableConfirmText = ''"
              />
              <Button
                color="error"
                size="sm"
                label="Permanently delete"
                :disabled="disableConfirmText !== orgName"
                @click="handleDisable"
              />
            </div>
          </div>
        </template>
      </Card>
    </template>
  </div>
</template>
