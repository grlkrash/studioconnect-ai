export function getAppBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.ADMIN_CUSTOM_DOMAIN_URL ||
    ''
  )
}

export function getPrimaryUrl(): string {
  return (
    process.env.APP_PRIMARY_URL ||
    process.env.ADMIN_CUSTOM_DOMAIN_URL ||
    ''
  )
} 