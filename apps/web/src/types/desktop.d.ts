export {}

declare global {
  interface Window {
    desktop?: {
      platform: string
      isElectron: boolean
      selectBackupFolder?: () => Promise<string | null>
    }
  }
}
