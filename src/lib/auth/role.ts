export const ROLE_MAP = {
  lab_portal: ['client', 'subuser'],
  admin_portal: ['admin', 'qc', 'account_manager', 'designer', 'consultant'],
  milling_portal: ['milling_admin', 'milling_production', 'milling_support'],
} as const

export type UserType = keyof typeof ROLE_MAP
export type UserRole = typeof ROLE_MAP[UserType][number]

export function isValidRoleForType(userType: UserType, role: UserRole): boolean {
  return (ROLE_MAP[userType] as readonly string[]).includes(role)
}