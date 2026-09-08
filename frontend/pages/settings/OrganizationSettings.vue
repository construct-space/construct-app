<script setup lang="ts">
import { Alert, Badge, Button, Card, Input, Separator } from '@construct-space/ui'
import { useOrgStore } from '@/stores/org'
import { useAuthStore } from '@/stores/auth'
import { useSource } from '@/composables/useSource'
import { Briefcase, Building2, Mail, ShieldAlert, UserPlus, Users, UsersRound } from 'lucide-vue-next'
import DormancyWarning from '@/components/org/DormancyWarning.vue'
import OrgProviderKeys from '@/components/org/OrgProviderKeys.vue'

const store = useOrgStore()
const authStore = useAuthStore()
const api = useSource()
const router = useRouter()

const pendingDormancy = ref<{ token: string; orgName: string } | null>(null)

const orgName = ref('')
const enabling = ref(false)
const disabling = ref(false)
const confirmDisable = ref(false)
const confirmText = ref('')
const inviteCode = ref('')
const joining = ref(false)
const joinError = ref('')

onMounted(async () => {
  await store.fetchAll()
})

async function handleEnable() {
  if (!orgName.value.trim()) return
  enabling.value = true
  try {
    await store.enable(orgName.value.trim())
    await store.fetchAll()
    // Refresh auth scope so isOrgManaged/scope flip to 'org' and the
    // settings shell reactively swaps to the org settings — without this
    // the org section only appeared after a manual reload. Mirrors the
    // join flow in performJoin().
    await authStore.refreshScope()
  } finally {
    enabling.value = false
  }
}

async function handleJoin() {
  if (inviteCode.value.length < 6) return
  joining.value = true
  joinError.value = ''
  const token = inviteCode.value.toUpperCase()

  try {
    const info = await store.getInviteInfo(token)
    if (info && authStore.isDeveloper && !info.org.is_publisher) {
      pendingDormancy.value = { token, orgName: info.org.name }
      joining.value = false
      return
    }
  } catch { /* fall through */ }

  await performJoin(token)
}

async function performJoin(token: string) {
  joining.value = true
  joinError.value = ''
  try {
    await api.post(`/org/invites/${token}/accept`, {
      user_id: authStore.user?.id || '',
      name: authStore.user?.name || authStore.user?.email || '',
    })
    store.hydrated = false
    await store.fetchAll()
    await authStore.refreshScope()
  } catch (err: unknown) {
    joinError.value = err instanceof Error ? err.message : 'Failed to join'
  } finally {
    joining.value = false
  }
}

function confirmDormancyJoin() {
  const pending = pendingDormancy.value
  if (!pending) return
  pendingDormancy.value = null
  performJoin(pending.token)
}

function cancelDormancyJoin() {
  pendingDormancy.value = null
}

async function handleDisable() {
  disabling.value = true
  try {
    await store.disable()
    // Resync auth scope so isOrgManaged/scope drop back to personal and
    // the org settings shell reactively swaps out (no manual reload).
    await authStore.refreshScope()
    confirmDisable.value = false
    confirmText.value = ''
  } finally {
    disabling.value = false
  }
}

const isOwner = computed(() => authStore.isOrgManaged && authStore.orgRole === 'owner')
</script>

<template>
  <div class="space-y-4">
    <!-- Managed workspace banner -->
    <Alert
      v-if="authStore.isOrgManaged"
      color="warning"
      icon="lucide:building-2"
      :title="`This workspace is managed by ${store.orgName}`"
      description="Settings like providers, MCP servers, and skills are controlled by org admins."
    />

    <!-- Not enabled: setup -->
    <template v-if="!store.isEnabled">
      <!-- Intro -->
      <Card variant="muted">
        <template #header>
          <div class="flex items-start gap-3">
            <Building2 class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Organization</h3>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">Shared workspaces, member management, and team collaboration.</p>
            </div>
          </div>
        </template>
      </Card>

      <p class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] pt-1">Get started</p>

      <!-- Create -->
      <Card>
        <template #header>
          <div class="flex items-start gap-3">
            <Building2 class="size-5 shrink-0 text-[var(--app-muted)] mt-0.5" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Create an organization</h4>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">Give your workspace a name. You'll be the owner.</p>
            </div>
          </div>
        </template>

        <div class="flex gap-2 items-start">
          <div class="flex-1">
            <Input
              v-model="orgName"
              placeholder="Organization name"
              @keydown.enter="handleEnable"
            />
          </div>
          <Button
            variant="solid"
            size="sm"
            :disabled="!orgName.trim() || enabling"
            :loading="enabling"
            label="Create"
            @click="handleEnable"
          />
        </div>
      </Card>

      <!-- Join -->
      <Card>
        <template #header>
          <div class="flex items-start gap-3">
            <UserPlus class="size-5 shrink-0 text-[var(--app-muted)] mt-0.5" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Join an organization</h4>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">Enter the 6-character invite code from your email.</p>
            </div>
          </div>
        </template>

        <div class="flex gap-2 items-start">
          <div class="w-40">
            <Input
              v-model="inviteCode"
              placeholder="ABC123"
              class="font-mono tracking-widest uppercase text-center"
              @keydown.enter="handleJoin"
            />
          </div>
          <Button
            variant="solid"
            size="sm"
            :disabled="inviteCode.length < 6 || joining"
            :loading="joining"
            label="Join"
            @click="handleJoin"
          />
        </div>
        <p v-if="joinError" class="text-xs text-red-500 mt-2">{{ joinError }}</p>
      </Card>
    </template>

    <!-- Enabled: org info + management -->
    <template v-else>
      <!-- Intro -->
      <Card variant="muted">
        <template #header>
          <div class="flex items-start gap-3">
            <Building2 class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ store.orgName }}</h3>
                <Badge color="success" size="xs">Active</Badge>
              </div>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">Shared workspaces, member management, and team collaboration.</p>
            </div>
          </div>
        </template>
        <template #accessory>
          <Button
            variant="soft"
            size="xs"
            label="Manage"
            @click="router.push('/app/org/settings')"
          />
        </template>
      </Card>

      <p class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] pt-1">Directory</p>

      <!-- Members -->
      <Card>
        <template #header>
          <div class="flex items-start gap-3">
            <Users class="size-5 shrink-0 text-[var(--app-muted)] mt-0.5" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Members</h4>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">{{ store.memberCount }} {{ store.memberCount === 1 ? 'member' : 'members' }}</p>
            </div>
          </div>
        </template>
        <template #accessory>
          <Button
            variant="soft"
            size="xs"
            label="View"
            @click="router.push('/app/org/members')"
          />
        </template>
      </Card>

      <!-- Departments -->
      <Card>
        <template #header>
          <div class="flex items-start gap-3">
            <Briefcase class="size-5 shrink-0 text-[var(--app-muted)] mt-0.5" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Departments</h4>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">{{ store.departmentCount }} {{ store.departmentCount === 1 ? 'department' : 'departments' }}</p>
            </div>
          </div>
        </template>
        <template #accessory>
          <Button
            variant="soft"
            size="xs"
            label="View"
            @click="router.push('/app/org/departments')"
          />
        </template>
      </Card>

      <!-- Teams -->
      <Card>
        <template #header>
          <div class="flex items-start gap-3">
            <UsersRound class="size-5 shrink-0 text-[var(--app-muted)] mt-0.5" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Teams</h4>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">{{ store.teamCount }} {{ store.teamCount === 1 ? 'team' : 'teams' }}</p>
            </div>
          </div>
        </template>
      </Card>

      <!-- Pending invites -->
      <Card>
        <template #header>
          <div class="flex items-start gap-3">
            <Mail class="size-5 shrink-0 text-[var(--app-muted)] mt-0.5" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Pending invites</h4>
                <Badge v-if="store.pendingInviteCount > 0" color="warning" size="xs">{{ store.pendingInviteCount }} waiting</Badge>
              </div>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">{{ store.pendingInviteCount }} {{ store.pendingInviteCount === 1 ? 'invitation' : 'invitations' }} awaiting response.</p>
            </div>
          </div>
        </template>
        <template v-if="store.pendingInviteCount > 0" #accessory>
          <Button
            variant="soft"
            size="xs"
            label="View"
            @click="router.push('/app/org/invitations')"
          />
        </template>
      </Card>

      <!-- Shared provider keys (owner/admin only) -->
      <OrgProviderKeys v-if="isOwner" />

      <!-- Danger zone (owner only) -->
      <template v-if="isOwner">
        <Separator label="Danger Zone" color="accent" class="mt-4" />

        <Card>
          <template #header>
            <div class="flex items-start gap-3">
              <ShieldAlert class="size-5 shrink-0 text-red-500/80 mt-0.5" />
              <div class="min-w-0 flex-1">
                <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Disable organization</h4>
                <p class="text-sm text-[var(--app-muted)] mt-0.5">Removes all organization data including members, departments, teams, and invitations. Organization-scoped spaces will become unavailable.</p>
              </div>
            </div>
          </template>

          <template v-if="!confirmDisable" #accessory>
            <Button
              variant="soft"
              color="error"
              size="xs"
              label="Disable"
              @click="confirmDisable = true"
            />
          </template>

          <div v-if="confirmDisable" class="space-y-2">
            <p class="text-xs text-red-500">
              Type <span class="font-mono font-bold">{{ store.orgName }}</span> to confirm:
            </p>
            <div class="flex gap-2">
              <div class="flex-1">
                <Input
                  v-model="confirmText"
                  :placeholder="store.orgName"
                />
              </div>
              <Button
                variant="soft"
                color="error"
                size="sm"
                :disabled="confirmText !== store.orgName || disabling"
                :loading="disabling"
                label="Confirm"
                @click="handleDisable"
              />
              <Button
                variant="ghost"
                color="neutral"
                size="sm"
                label="Cancel"
                @click="confirmDisable = false; confirmText = ''"
              />
            </div>
          </div>
        </Card>
      </template>
    </template>

    <DormancyWarning
      v-if="pendingDormancy"
      :org-name="pendingDormancy.orgName"
      :on-continue="confirmDormancyJoin"
      :on-cancel="cancelDormancyJoin"
    />
  </div>
</template>
