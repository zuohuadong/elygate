export type RoleInfo = { code: string; name: string; [key: string]: any };
export type ResourceInfo = { code: string; name: string; section?: string; [key: string]: any };
export type ActionInfo = { code: string; name: string; [key: string]: any };

export interface Tenant {
  id: string;
  name: string;
  logo?: string;
  [key: string]: unknown;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BackgroundTask {
  id: string;
  title: string;
  status: TaskStatus;
  progress?: number; // 0-100
  message?: string;
  createdAt: string | Date;
  downloadUrl?: string;
  [key: string]: unknown;
}

export interface GridModule {
  id: string;
  w: number;
  h: number;
  x: number;
  y: number;
  title?: string;
  componentProps?: any; // Component specific props
}
