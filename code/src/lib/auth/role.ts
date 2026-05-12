export const ROLE_MAP = {
  dental_lab:         ['client', 'subuser'],
  dental_lab_service: ['admin', 'qc', 'account_manager', 'designer'],
} as const

export type UserType = keyof typeof ROLE_MAP
export type UserRole = typeof ROLE_MAP[UserType][number]

export function isValidRoleForType(userType: UserType, role: UserRole): boolean {
  return (ROLE_MAP[userType] as readonly string[]).includes(role)
}