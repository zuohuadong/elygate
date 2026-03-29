/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '@svadmin/core' {
  export interface ResourceTypeMap {
    channels: {
      id: number;
      name: string;
      type: number;
      baseUrl: string;
      key: string;
      models: string[];
      status: number;
      priority: number;
      weight: number;
    };
    users: {
      id: number;
      username: string;
      role: number;
      quota: number;
      usedQuota: number;
      status: number;
    };
    tokens: {
      id: number;
      name: string;
      key: string;
      status: number;
      remainQuota: number;
      usedQuota: number;
      models: string[];
      userId: number;
      creatorName: string;
    };
    'user-groups': {
      key: string;
      name: string;
      description: string;
      status: number;
    };
    packages: {
      id: number;
      name: string;
      price: number;
      durationDays: number;
      models: string[];
      isPublic: boolean;
    };
    redemptions: {
      id: number;
      name: string;
      key: string;
      quota: number;
      count: number;
      status: number;
    };
    'rate-limits': {
      id: number;
      name: string;
      rpm: number;
      rph: number;
      concurrent: number;
    };
  }
}
