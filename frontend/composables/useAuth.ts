// This composable is now just for backward compatibility
// Components should use the store directly: const authStore = useAuthStore()

export const useAuth = () => {
  return useAuthStore()
}