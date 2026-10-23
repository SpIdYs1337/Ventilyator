export const permissionKeys = ['system:read', 'users:manage', 'roles:manage', 'sessions:revoke', 'audit:read', 'projects:create', 'projects:manage'] as const;
export type PermissionKey = typeof permissionKeys[number];
export const defaultRoles: Record<string, readonly PermissionKey[]> = {
  'System Administrator': permissionKeys,
  'Organization Administrator': permissionKeys,
  'Department Manager': ['projects:create'],
  'Project Administrator': ['projects:create'],
  'Team Member': [],
  Viewer: [],
  Guest: [],
};
export interface CurrentUser { id: string; email: string; name: string; organizationId: string; permissions: string[] }
export interface SystemStatus { postgres: boolean; redis: boolean; storage: boolean; worker: boolean }
export * from './work';
